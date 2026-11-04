//! Sends requests to the public routes of the delivery service.

use std::fmt::Write as _;
use std::io::Write;
use std::time::Duration;

use ltk_manager_base::hashing::copy_verified;
use reqwest::StatusCode;
use reqwest::blocking::{Client, Response};
use reqwest::header::{ETAG, IF_NONE_MATCH};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use super::manifest::{Envelope, Release};
use super::{Channel, DeliveryError};

/// Highest proof-of-work difficulty that the client attempts, in leading zero bits.
/// A solve at this difficulty takes a few seconds on one core.
const MAX_DIFFICULTY: u32 = 24;

/// The answer to an offer request.
pub(super) enum Offer {
    /// The manifest that matches the sent ETag is current.
    Unchanged,
    /// The current manifest of the channel and its ETag.
    Changed {
        envelope: Envelope,
        etag: Option<String>,
    },
    /// No range of the channel serves this manager version.
    Incompatible,
}

/// A client for the public `/v1` routes.
pub(super) struct Service {
    client: Client,
    url: String,
}

impl Service {
    /// Builds a client that sends `user_agent`, which the service requires to be
    /// `ltk-manager/<version>`.
    pub(super) fn new(url: &str, user_agent: &str) -> Result<Self, DeliveryError> {
        let client = Client::builder()
            .user_agent(user_agent)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .build()?;

        Ok(Self {
            client,
            url: url.trim_end_matches('/').to_string(),
        })
    }

    /// Registers `install` as a `version` build of `client` with its build `attestation`
    /// and returns its bearer token.
    ///
    /// Solves the proof-of-work challenge of the service first. Fails if the challenge
    /// difficulty is above [`MAX_DIFFICULTY`].
    pub(super) fn register(
        &self,
        install: &str,
        client: &str,
        version: &str,
        attestation: &str,
    ) -> Result<String, DeliveryError> {
        #[derive(Deserialize)]
        struct Challenge {
            challenge: String,
            difficulty: u32,
        }

        #[derive(Deserialize)]
        struct Registered {
            token: String,
        }

        let challenge: Challenge = checked(
            self.client
                .get(format!("{}/v1/challenge", self.url))
                .query(&[("install", install)])
                .send()?,
        )?
        .json()?;
        if challenge.difficulty > MAX_DIFFICULTY {
            return Err(DeliveryError::Difficulty(challenge.difficulty));
        }

        let nonce = solve(&challenge.challenge, challenge.difficulty);
        let registered: Registered = checked(
            self.client
                .post(format!("{}/v1/installs", self.url))
                .json(&json!({
                    "install": install,
                    "client": client,
                    "version": version,
                    "attestation": attestation,
                    "challenge": challenge.challenge,
                    "nonce": nonce,
                }))
                .send()?,
        )?
        .json()?;

        Ok(registered.token)
    }

    /// Requests the manifest that `channel` offers to the `version` build of this client.
    ///
    /// Returns [`Offer::Unchanged`] if `etag` is still current. Returns
    /// [`Offer::Incompatible`] if the service answers `409`.
    pub(super) fn offer(
        &self,
        token: &str,
        channel: Channel,
        version: &str,
        etag: Option<&str>,
    ) -> Result<Offer, DeliveryError> {
        #[derive(Deserialize)]
        struct Offered {
            manifest: Envelope,
        }

        let mut request = self
            .client
            .get(format!("{}/v1/offer", self.url))
            .query(&[("channel", channel.as_str()), ("version", version)])
            .bearer_auth(token);
        if let Some(etag) = etag {
            request = request.header(IF_NONE_MATCH, etag);
        }

        let response = request.send()?;
        match response.status() {
            StatusCode::NOT_MODIFIED => return Ok(Offer::Unchanged),
            StatusCode::CONFLICT => return Ok(Offer::Incompatible),
            _ => {}
        }

        let response = checked(response)?;
        let etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let offered: Offered = response.json()?;

        Ok(Offer::Changed {
            envelope: offered.manifest,
            etag,
        })
    }

    /// Downloads the DLL of `release` into `destination`.
    ///
    /// Fails with [`DeliveryError::Integrity`] if the body differs from the size or the
    /// SHA-256 of the release.
    pub(super) fn download(
        &self,
        token: &str,
        release: &Release,
        destination: &mut impl Write,
    ) -> Result<(), DeliveryError> {
        let mut response = checked(
            self.client
                .get(format!("{}/v1/dll/{}", self.url, release.digest))
                .bearer_auth(token)
                .send()?,
        )?;

        let verified = copy_verified(
            &mut response,
            destination,
            release.size,
            &release.digest,
            |_| Ok::<(), DeliveryError>(()),
        )?;
        if !verified {
            return Err(DeliveryError::Integrity);
        }

        Ok(())
    }
}

/// Returns `response` if its status is a success.
///
/// Fails with [`DeliveryError::Unauthorized`] for `401` and with [`DeliveryError::Refused`]
/// for any other status.
fn checked(response: Response) -> Result<Response, DeliveryError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    if status == StatusCode::UNAUTHORIZED {
        return Err(DeliveryError::Unauthorized);
    }

    let reason = response
        .json::<serde_json::Value>()
        .ok()
        .and_then(|body| {
            let field = body.get("reason").or_else(|| body.get("error"))?;
            field.as_str().map(str::to_string)
        })
        .unwrap_or_default();

    Err(DeliveryError::Refused {
        status: status.as_u16(),
        reason,
    })
}

/// Returns a hex nonce such that SHA-256 of `challenge` followed by the nonce has at
/// least `difficulty` leading zero bits.
pub(super) fn solve(challenge: &str, difficulty: u32) -> String {
    let prefix = Sha256::new_with_prefix(challenge.as_bytes());
    let mut nonce = String::new();

    for n in 0u64.. {
        nonce.clear();
        write!(nonce, "{n:x}").expect("a String write does not fail");
        let digest = prefix.clone().chain_update(nonce.as_bytes()).finalize();
        if leading_zero_bits(&digest) >= difficulty {
            return nonce;
        }
    }

    unreachable!("a u64 nonce space holds a solution for any difficulty up to MAX_DIFFICULTY")
}

/// Returns the number of leading zero bits of `digest`.
pub(super) fn leading_zero_bits(digest: &[u8]) -> u32 {
    let mut bits = 0;
    for byte in digest {
        if *byte != 0 {
            return bits + byte.leading_zeros();
        }
        bits += 8;
    }
    bits
}

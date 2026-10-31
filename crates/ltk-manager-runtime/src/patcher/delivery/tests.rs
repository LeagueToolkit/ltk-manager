use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, LazyLock, Mutex};

use assert_matches::assert_matches;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::service::{leading_zero_bits, solve};
use super::*;

// Public key, manifest and signature of the delivery service fixture, signed by minisign 0.12.
const SERVICE_PUBLIC_KEY: &str = "RWQlo0fqQ4hvQkwwTM3zsd7UjbJSjSQ8XIbeDhswvvd+k6G6j8UdzNuw";
const SERVICE_MESSAGE: &str = r#"{"schema":1,"channel":"stable","sequence":1,"issued":1758715200,"release":{"version":"ltk_patcher-15","digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1843200,"protocol":2,"managers":">=1.22.0, <2.0.0","eol":1790665200,"future":"preserved"},"revoked":[],"future":{"note":"unknown fields remain signed"}}"#;
const SERVICE_SIGNATURE: &str = "untrusted comment: signature from minisign secret key\r\nRUQlo0fqQ4hvQhGoMSgiiYZCsrxx+TKDhNaFMgzqn2RFp+5vUBjNLuew9tTD1YZGsigN0uFuGBAly8byFsMHKI8F+knbnlBRHAk=\r\ntrusted comment: stable 1 ltk_patcher-15\r\nKnTQ9K1m4O6Lx0xsfYlo+aOr/ezAp9dzLQu88waAFUC5MbKl9NKwftiHacHzouY8kaDRq4x21+qYAyz/RsCFDg==\r\n";

const DELIVERED_DLL: &[u8] = b"delivered dll";

/// A time before the end of life of every fixture, in Unix seconds.
const BEFORE_EOL: u64 = 0;

/// A time after the end of life of every fixture, in Unix seconds.
const AFTER_EOL: u64 = u64::MAX;

/// Manifests signed with a throwaway key. `offered` offers the
/// DLL with the bytes [`DELIVERED_DLL`], and `withdrawn` revokes it.
#[derive(Deserialize)]
struct Fixtures {
    #[serde(rename = "publicKey")]
    public_key: String,
    offered: Envelope,
    withdrawn: Envelope,
}

static FIXTURES: LazyLock<Fixtures> =
    LazyLock::new(|| serde_json::from_str(include_str!("fixtures.json")).unwrap());

fn service_envelope(message: &str) -> Envelope {
    Envelope {
        manifest: STANDARD.encode(message),
        signature: SERVICE_SIGNATURE.to_string(),
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// A delivery rooted in a temporary directory, with the bundled host beside it.
struct Setup {
    _dir: tempfile::TempDir,
    delivery: PatcherDelivery,
    host: PathBuf,
}

fn setup(cached: Option<&Envelope>) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let bundled = dir.path().join("bundle");
    fs::create_dir_all(&bundled).unwrap();
    let host = bundled.join(HOST_EXE_NAME);
    fs::write(&host, b"host").unwrap();

    let delivery = PatcherDelivery {
        root: dir.path().join("delivery"),
        url: "http://127.0.0.1:9".to_string(),
        public_key: FIXTURES.public_key.clone(),
        attestation: Some("test".to_string()),
        manager: Version::new(1, 5, 0),
        protocol: 2,
    };
    if let Some(envelope) = cached {
        let mut state = State::default();
        state.channels.insert(
            Channel::Stable,
            Cached {
                etag: None,
                envelope: envelope.clone(),
            },
        );
        delivery.save(&state).unwrap();
    }

    Setup {
        _dir: dir,
        delivery,
        host,
    }
}

impl Setup {
    fn stage(&self, bytes: &[u8]) -> PathBuf {
        let dir = self.delivery.root.join(digest(DELIVERED_DLL));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(HOOK_DLL_NAME), bytes).unwrap();
        dir
    }

    fn select(&self) -> Option<StagedPatcher> {
        self.delivery.select(Channel::Stable, &self.host).unwrap()
    }
}

#[test]
fn verify_reads_manifest_signed_by_minisign() {
    let manifest =
        Manifest::verify(&service_envelope(SERVICE_MESSAGE), SERVICE_PUBLIC_KEY).unwrap();

    assert_eq!(manifest.channel, Channel::Stable);
    assert_eq!(manifest.sequence, 1);
    assert_eq!(manifest.release.version, "ltk_patcher-15");
    assert_eq!(manifest.release.protocol, 2);
    assert!(manifest.serves(&Version::new(1, 22, 0)));
    assert!(!manifest.serves(&Version::new(1, 21, 9)));
    assert!(!manifest.serves(&Version::new(2, 0, 0)));
}

#[test]
fn verify_fails_if_manifest_bytes_change() {
    let tampered = SERVICE_MESSAGE.replace("1843200", "1843201");

    assert_matches!(
        Manifest::verify(&service_envelope(&tampered), SERVICE_PUBLIC_KEY),
        Err(DeliveryError::Signature)
    );
}

#[test]
fn verify_fails_with_other_public_key() {
    assert_matches!(
        Manifest::verify(&service_envelope(SERVICE_MESSAGE), &FIXTURES.public_key),
        Err(DeliveryError::Signature)
    );
}

#[test]
fn solve_returns_nonce_with_requested_leading_zero_bits() {
    let nonce = solve("challenge", 12);
    let hash = Sha256::digest(format!("challenge{nonce}"));

    assert!(leading_zero_bits(&hash) >= 12);
}

#[test]
fn leading_zero_bits_counts_across_bytes() {
    assert_eq!(leading_zero_bits(&[0, 0, 0b0001_0000, 0xff]), 19);
    assert_eq!(leading_zero_bits(&[0, 0]), 16);
}

#[test]
fn select_returns_delivered_dll_beside_staged_host() {
    let setup = setup(Some(&FIXTURES.offered));
    let dir = setup.stage(DELIVERED_DLL);

    let staged = setup.select().unwrap();

    assert_eq!(staged.dir, dir);
    assert_eq!(staged.version, "ltk_patcher-20");
    assert_eq!(staged.digest, digest(DELIVERED_DLL));
    assert_eq!(fs::read(dir.join(HOST_EXE_NAME)).unwrap(), b"host");
}

#[test]
fn select_returns_none_if_staged_dll_differs_from_digest() {
    let setup = setup(Some(&FIXTURES.offered));
    setup.stage(b"replaced dll");

    assert_eq!(setup.select(), None);
}

#[test]
fn select_returns_none_if_release_protocol_differs() {
    let mut setup = setup(Some(&FIXTURES.offered));
    setup.stage(DELIVERED_DLL);
    setup.delivery.protocol = 3;

    assert_eq!(setup.select(), None);
}

#[test]
fn select_returns_none_if_release_does_not_serve_manager() {
    let mut setup = setup(Some(&FIXTURES.offered));
    setup.stage(DELIVERED_DLL);
    setup.delivery.manager = Version::new(2, 0, 0);

    assert_eq!(setup.select(), None);
}

#[test]
fn select_returns_none_if_manifest_revokes_delivered_dll() {
    let setup = setup(Some(&FIXTURES.withdrawn));
    setup.stage(DELIVERED_DLL);

    assert_eq!(setup.select(), None);
}

#[test]
fn select_returns_none_without_cache() {
    assert_eq!(setup(None).select(), None);
}

#[test]
fn select_ignores_cached_manifest_that_does_not_verify() {
    let mut envelope = FIXTURES.withdrawn.clone();
    envelope.signature = FIXTURES.offered.signature.clone();
    let setup = setup(Some(&envelope));

    assert_eq!(setup.select(), None);
}

#[test]
fn select_falls_back_to_stable_on_beta_channel() {
    let setup = setup(Some(&FIXTURES.offered));
    setup.stage(DELIVERED_DLL);

    assert!(
        setup
            .delivery
            .select(Channel::Beta, &setup.host)
            .unwrap()
            .is_some()
    );
}

#[test]
fn staged_patcher_is_expired_only_past_its_eol() {
    let setup = setup(Some(&FIXTURES.offered));
    setup.stage(DELIVERED_DLL);
    let staged = setup.select().unwrap();

    assert!(!staged.is_expired(u64::from(staged.eol)));
    assert!(staged.is_expired(u64::from(staged.eol) + 1));
}

#[test]
fn staged_dll_path_names_the_dll_of_the_selected_build() {
    let setup = setup(Some(&FIXTURES.offered));
    let dir = setup.stage(DELIVERED_DLL);

    assert_eq!(
        setup.delivery.staged_dll_path(Channel::Stable),
        Some(dir.join(HOOK_DLL_NAME))
    );
}

#[test]
fn refresh_downloads_dll_if_none_is_staged() {
    let mut setup = setup(None);
    let (url, _requests) = serve(FIXTURES.offered.clone());
    setup.delivery.url = url;

    let staged = setup
        .delivery
        .refresh(Channel::Stable, &setup.host, BEFORE_EOL)
        .unwrap();

    assert_eq!(staged.digest, digest(DELIVERED_DLL));
    assert_eq!(
        fs::read(staged.dir.join(HOOK_DLL_NAME)).unwrap(),
        DELIVERED_DLL
    );
}

#[test]
fn refresh_fails_with_sync_failure_if_nothing_is_staged() {
    let mut setup = setup(None);
    setup.delivery.attestation = None;

    assert_matches!(
        setup
            .delivery
            .refresh(Channel::Stable, &setup.host, BEFORE_EOL),
        Err(DeliveryError::Unattested)
    );
}

#[test]
fn refresh_returns_expired_dll_if_sync_fails() {
    let mut setup = setup(Some(&FIXTURES.offered));
    setup.stage(DELIVERED_DLL);
    setup.delivery.attestation = None;

    let staged = setup
        .delivery
        .refresh(Channel::Stable, &setup.host, AFTER_EOL)
        .unwrap();

    assert_eq!(staged.digest, digest(DELIVERED_DLL));
}

#[test]
fn sync_fails_without_contacting_service_if_build_has_no_attestation() {
    let mut setup = setup(None);
    let (url, requests) = serve(FIXTURES.offered.clone());
    setup.delivery.url = url;
    setup.delivery.attestation = None;

    assert_matches!(
        setup.delivery.sync(Channel::Stable),
        Err(DeliveryError::Unattested)
    );
    assert!(requests.lock().unwrap().is_empty());
}

/// A request that the test server received: method, path and the headers it checks.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Request {
    method: String,
    path: String,
    authorization: Option<String>,
    if_none_match: Option<String>,
}

/// Serves the public routes with canned answers and records each request.
///
/// Accepts the token `t` only, refuses a registration with the attestation `refused`,
/// answers the offer with `offer` and the ETag `"e"`, and answers `304` to an offer that
/// sends that ETag.
fn serve(offer: Envelope) -> (String, Arc<Mutex<Vec<Request>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));

    let log = Arc::clone(&requests);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            answer(stream, &offer, &log);
        }
    });

    (url, requests)
}

fn answer(stream: TcpStream, offer: &Envelope, log: &Mutex<Vec<Request>>) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap().to_string();
    let path = parts.next().unwrap().split('?').next().unwrap().to_string();

    let mut request = Request {
        method,
        path,
        authorization: None,
        if_none_match: None,
    };
    let mut length = 0;
    loop {
        let mut header = String::new();
        reader.read_line(&mut header).unwrap();
        let Some((name, value)) = header.trim_end().split_once(": ") else {
            break;
        };
        match name.to_ascii_lowercase().as_str() {
            "content-length" => length = value.parse().unwrap(),
            "authorization" => request.authorization = Some(value.to_string()),
            "if-none-match" => request.if_none_match = Some(value.to_string()),
            _ => {}
        }
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();
    log.lock().unwrap().push(request.clone());

    let authorized = request.authorization.as_deref() == Some("Bearer t");
    let (status, headers, body): (&str, &str, Vec<u8>) = match request.path.as_str() {
        "/v1/challenge" => (
            "200 OK",
            "",
            br#"{"challenge":"c","difficulty":4,"expires":"2026-10-20T00:00:00Z"}"#.to_vec(),
        ),
        "/v1/installs" if body.windows(9).any(|w| w == b"\"refused\"") => {
            ("403 Forbidden", "", br#"{"reason":"attestation"}"#.to_vec())
        }
        "/v1/installs" => ("200 OK", "", br#"{"token":"t"}"#.to_vec()),
        _ if !authorized => ("401 Unauthorized", "", Vec::new()),
        "/v1/offer" if request.if_none_match.as_deref() == Some("\"e\"") => {
            ("304 Not Modified", "ETag: \"e\"\r\n", Vec::new())
        }
        "/v1/offer" => (
            "200 OK",
            "ETag: \"e\"\r\n",
            serde_json::to_vec(&serde_json::json!({ "manifest": offer })).unwrap(),
        ),
        _ => ("200 OK", "", DELIVERED_DLL.to_vec()),
    };

    let mut stream = stream;
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n",
        body.len()
    )
    .unwrap();
    stream.write_all(&body).unwrap();
}

fn paths(requests: &Mutex<Vec<Request>>) -> Vec<String> {
    requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| format!("{} {}", request.method, request.path))
        .collect()
}

#[test]
fn sync_registers_and_downloads_offered_dll() {
    let mut setup = setup(None);
    let (url, requests) = serve(FIXTURES.offered.clone());
    setup.delivery.url = url;

    setup.delivery.sync(Channel::Stable).unwrap();

    assert_eq!(
        paths(&requests),
        [
            "GET /v1/challenge".to_string(),
            "POST /v1/installs".to_string(),
            "GET /v1/offer".to_string(),
            format!("GET /v1/dll/{}", digest(DELIVERED_DLL)),
        ]
    );
    assert!(setup.select().is_some());
}

#[test]
fn sync_sends_etag_and_skips_download_if_offer_is_unchanged() {
    let mut setup = setup(None);
    let (url, requests) = serve(FIXTURES.offered.clone());
    setup.delivery.url = url;
    setup.delivery.sync(Channel::Stable).unwrap();
    requests.lock().unwrap().clear();

    setup.delivery.sync(Channel::Stable).unwrap();

    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].path, "/v1/offer");
    assert_eq!(requests[0].if_none_match.as_deref(), Some("\"e\""));
}

#[test]
fn sync_registers_again_if_token_is_refused() {
    let mut setup = setup(None);
    let (url, requests) = serve(FIXTURES.offered.clone());
    setup.delivery.url = url;
    let state = State {
        install: Some(Uuid::new_v4().to_string()),
        token: Some("expired".to_string()),
        ..State::default()
    };
    setup.delivery.save(&state).unwrap();

    setup.delivery.sync(Channel::Stable).unwrap();

    assert_eq!(
        paths(&requests)[..4],
        [
            "GET /v1/offer",
            "GET /v1/challenge",
            "POST /v1/installs",
            "GET /v1/offer"
        ]
    );
    assert_eq!(setup.delivery.load().token.as_deref(), Some("t"));
}

#[test]
fn sync_fails_if_attestation_is_refused() {
    let mut setup = setup(None);
    let (url, requests) = serve(FIXTURES.offered.clone());
    setup.delivery.url = url;
    setup.delivery.attestation = Some("refused".to_string());

    assert_matches!(
        setup.delivery.sync(Channel::Stable),
        Err(DeliveryError::Refused { status: 403, ref reason }) if reason == "attestation"
    );
    assert_eq!(paths(&requests), ["GET /v1/challenge", "POST /v1/installs"]);
}

#[test]
fn attested_manager_reads_statement_version() {
    let statement = URL_SAFE_NO_PAD.encode(br#"{"manager":"1.29.0","commit":"0"}"#);

    assert_eq!(
        attested_manager(&format!("{statement}.sig")).as_deref(),
        Some("1.29.0")
    );
    assert_eq!(attested_manager("not base64url!.sig"), None);
    assert_eq!(attested_manager(""), None);
}

#[test]
fn sync_fails_if_offer_is_older_than_cached_manifest() {
    let mut setup = setup(Some(&FIXTURES.withdrawn));
    let (url, _requests) = serve(FIXTURES.offered.clone());
    setup.delivery.url = url;

    assert_matches!(
        setup.delivery.sync(Channel::Stable),
        Err(DeliveryError::Stale {
            offered: 2,
            cached: 3,
            ..
        })
    );
}

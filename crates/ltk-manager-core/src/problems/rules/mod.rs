//! The checks the manager runs, one module for each.
//!
//! A new check is a rule and a row, and never a new panel. A rule is added
//! here, and every surface that draws problems draws it without changing.

pub mod audio_bank_id;
pub mod audio_bank_version;
pub mod bin_property_type;
pub mod bin_resolver_key_loss;
pub mod tex_block_alignment;
pub mod vfx_random;

use super::Rule;

/// Every rule a run calls, in the order it calls them.
///
/// `vfx_random`'s two rules are held out of the list while their findings are too noisy to
/// draw. The module stays compiled, so each is one line to put back.
#[must_use]
pub fn all() -> Vec<Box<dyn Rule>> {
    vec![
        Box::new(bin_property_type::BinPropertyType::new()),
        Box::new(audio_bank_version::AudioBankVersion::new()),
        Box::new(audio_bank_id::AudioBankId::new()),
        Box::new(tex_block_alignment::TexBlockAlignment::new()),
        Box::new(bin_resolver_key_loss::BinResolverKeyLoss::new()),
    ]
}

#[cfg(test)]
mod tests;

//! What the project has to tell a reader, as Home draws it.
//!
//! Two feeds, because the two things the project says have different shapes.
//! An [`announcements::Announcement`] is a post, read from the Announcements
//! category of the repository's Discussions. A [`notices::Notice`] is one line
//! that has to be seen, read from a document this repository owns. Both are
//! GitHub reads, on the client the release feed uses.

pub mod announcements;
pub mod notices;

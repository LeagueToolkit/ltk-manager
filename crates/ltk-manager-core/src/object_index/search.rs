//! The ranked view the command palette reads: the best rows for one query.

use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

use ltk_hash::BinHash;
use ltk_wad::hex_name;

use crate::bin_document::hex;
use crate::game_index::SEARCH_LIMIT;
use crate::matcher::{EXACT_SCORE, Query, Range, mask_covers};

use super::{
    ObjectClassHit, ObjectIndex, ObjectSearchHit, ObjectSearchResult, Row, STALE_CHECK_INTERVAL,
    parse_hash,
};

/// Band, score and marked runs for one object path, or `None` for no match.
///
/// The last `/` segment is the name: a query that opens it is band 0, one it
/// holds is band 1, and a query the rest of the path is needed for is band 2.
/// The runs are offsets into the whole path either way.
fn rank(query: &Query, path: &str) -> Option<(u8, f64, Vec<Range>)> {
    let cut = path.rfind('/').map_or(0, |at| at + 1);
    let name = &path[cut..];

    if let Some(matched) = query.matches(name) {
        let band = u8::from(!query.starts(name));
        let cut = cut as u32;
        let ranges = matched
            .ranges
            .into_iter()
            .map(|(start, end)| (start + cut, end + cut))
            .collect();
        return Some((band, matched.score, ranges));
    }

    if cut == 0 {
        return None;
    }
    let matched = query.matches(path)?;
    Some((2, matched.score, matched.ranges))
}

/// The `class:` term of a query, and whether it was the last term typed.
///
/// Read by the objects source alone. Every other source sees the term as
/// text, which is why it is split off here rather than in the palette.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ClassTerm<'a> {
    /// What follows the colon: a name prefix, a hash, or nothing.
    pub(super) value: &'a str,
    pub(super) last: bool,
}

impl<'a> ClassTerm<'a> {
    /// The key a class term opens with, in any case.
    const KEY: &'static str = "class:";

    /// The class term of `query`, if one, and the rest of the query joined back.
    pub(super) fn split(query: &'a str) -> (Option<Self>, Cow<'a, str>) {
        let terms: Vec<&str> = query.split_whitespace().collect();
        let at = terms.iter().position(|term| {
            term.get(..Self::KEY.len())
                .is_some_and(|head| head.eq_ignore_ascii_case(Self::KEY))
        });
        let Some(at) = at else {
            return (None, Cow::Borrowed(query));
        };

        let class = Self {
            value: &terms[at][Self::KEY.len()..],
            last: at + 1 == terms.len(),
        };
        let rest = terms
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != at)
            .map(|(_, term)| *term)
            .collect::<Vec<&str>>()
            .join(" ");
        (Some(class), Cow::Owned(rest))
    }
}

/// One kept row, ordered worst first so a bounded heap drops the right one.
#[derive(Debug)]
struct Hit<'a> {
    band: u8,
    score: f64,
    /// The length of the object path, so the shorter one wins a tie.
    length: u32,
    /// The archive's ordinal, so two declarations tie in archive order.
    wad: u32,
    name: &'a str,
    file: &'a str,
    at: u32,
}

impl Ord for Hit<'_> {
    /// Greater is worse: a higher band, a lower score, a longer path, a later
    /// archive, a later path, a later declaring file, and then a later row.
    fn cmp(&self, other: &Self) -> Ordering {
        self.band
            .cmp(&other.band)
            .then_with(|| other.score.total_cmp(&self.score))
            .then_with(|| self.length.cmp(&other.length))
            .then_with(|| self.wad.cmp(&other.wad))
            .then_with(|| self.name.cmp(other.name))
            .then_with(|| self.file.cmp(other.file))
            .then_with(|| self.at.cmp(&other.at))
    }
}

impl PartialOrd for Hit<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Hit<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Hit<'_> {}

impl ObjectIndex {
    /// The best rows of the index for one query, best first.
    ///
    /// A `class:` term narrows the rows first, to the classes whose name the
    /// term opens or to the one class whose hash it is. While that term is the
    /// last one typed and more than one class matches, the answer is those
    /// classes as completions and no rows.
    ///
    /// A query of eight hex digits, with or without `0x`, is looked up as a
    /// hash rather than matched. Anything else is ranked on the shared rule,
    /// with the last `/` segment of the object's path taking the name's band.
    ///
    /// `is_overtaken` is tested every few thousand rows, the contract
    /// [`GameIndex::search`](crate::game_index::GameIndex::search) sets. An empty query
    /// matches nothing, unless a class term narrowed it, and then every row of the class
    /// lists by path.
    pub fn search(&self, query: &str, is_overtaken: impl Fn() -> bool) -> ObjectSearchResult {
        let rows = &self.declared.rows;
        let unnamed = self.names.objects.is_empty() && !rows.is_empty();

        let (class_term, query) = ClassTerm::split(query);
        let classes = match class_term {
            None => None,
            Some(term) => {
                let matched = self.classes_opened_by(term.value);
                if term.last && matched.len() != 1 {
                    return self.class_completions(&matched, unnamed);
                }
                if matched.is_empty() {
                    return ObjectSearchResult::empty(unnamed);
                }
                Some(matched.into_iter().collect::<HashSet<BinHash>>())
            }
        };

        if let Some(hash) = parse_hash(&query) {
            return self.by_hash(hash, classes.as_ref(), unnamed);
        }

        let Some(query) = Query::parse(&query) else {
            return match classes {
                Some(classes) => self.listed(&classes, unnamed),
                None => ObjectSearchResult::empty(unnamed),
            };
        };

        let mask = query.mask();
        let mut heap: BinaryHeap<Hit<'_>> = BinaryHeap::with_capacity(SEARCH_LIMIT + 1);
        let mut total = 0u32;
        let mut since_check = 0u32;
        let mut overtaken = false;

        for (at, row) in rows.iter().enumerate() {
            since_check += 1;
            if since_check >= STALE_CHECK_INTERVAL {
                since_check = 0;
                overtaken = is_overtaken();
                if overtaken {
                    break;
                }
            }

            if classes
                .as_ref()
                .is_some_and(|classes| !classes.contains(&row.class))
            {
                continue;
            }
            let Some(named) = self.named_object(row.object) else {
                continue;
            };
            if !mask_covers(named.mask, mask) {
                continue;
            }
            let Some((band, score, _)) = rank(&query, &named.name) else {
                continue;
            };

            total += 1;
            let file = self.declared.file(row.file);
            let hit = Hit {
                band,
                score,
                length: named.name.len() as u32,
                wad: file.map_or(0, |file| file.wad),
                name: &named.name,
                file: file.and_then(|file| file.path.as_deref()).unwrap_or(""),
                at: at as u32,
            };
            if heap.len() < SEARCH_LIMIT {
                heap.push(hit);
            } else if heap.peek().is_some_and(|worst| hit < *worst) {
                heap.pop();
                heap.push(hit);
            }
        }

        let hits = heap
            .into_sorted_vec()
            .into_iter()
            .map(|hit| {
                /* Recomputed for the rows that survived, which is cheaper than
                keeping a run list per candidate the heap then drops. */
                let ranges = rank(&query, hit.name).map_or_else(Vec::new, |(_, _, ranges)| ranges);
                self.hit(hit.at as usize, hit.band, hit.score, ranges)
            })
            .collect();

        ObjectSearchResult {
            hits,
            total,
            superseded: overtaken,
            unnamed,
            classes: Vec::new(),
        }
    }

    /// Every declaration of one object, in row order, under `classes` if any.
    fn by_hash(
        &self,
        hash: BinHash,
        classes: Option<&HashSet<BinHash>>,
        unnamed: bool,
    ) -> ObjectSearchResult {
        let rows = &self.declared.rows;
        let wanted = |row: &Row| {
            row.object == hash && classes.is_none_or(|classes| classes.contains(&row.class))
        };
        let total = rows.iter().filter(|row| wanted(row)).count() as u32;
        let hits = rows
            .iter()
            .enumerate()
            .filter(|(_, row)| wanted(row))
            .take(SEARCH_LIMIT)
            .map(|(at, _)| self.hit(at, 0, EXACT_SCORE, Vec::new()))
            .collect();

        ObjectSearchResult {
            hits,
            total,
            superseded: false,
            unnamed,
            classes: Vec::new(),
        }
    }

    /// Every row of `classes`, by path, for a class term with nothing after it.
    fn listed(&self, classes: &HashSet<BinHash>, unnamed: bool) -> ObjectSearchResult {
        let rows = &self.declared.rows;
        let mut kept: Vec<(Cow<'_, str>, u32)> = rows
            .iter()
            .enumerate()
            .filter(|(_, row)| classes.contains(&row.class))
            .map(|(at, row)| {
                let name = self.named_object(row.object).map_or_else(
                    || Cow::Owned(hex(row.object)),
                    |named| Cow::Borrowed(&*named.name),
                );
                (name, at as u32)
            })
            .collect();
        kept.sort_unstable();

        ObjectSearchResult {
            total: kept.len() as u32,
            hits: kept
                .into_iter()
                .take(SEARCH_LIMIT)
                .map(|(_, at)| self.hit(at as usize, 0, 0.0, Vec::new()))
                .collect(),
            superseded: false,
            unnamed,
            classes: Vec::new(),
        }
    }

    /// The classes a `class:` term opens: one by hash, else every named class
    /// whose name starts with it, by name.
    pub(super) fn classes_opened_by(&self, term: &str) -> Vec<BinHash> {
        if let Some(hash) = parse_hash(term) {
            return vec![hash];
        }
        let mut matched: Vec<(&str, BinHash)> = self
            .names
            .classes
            .iter()
            .filter(|(_, name)| {
                name.get(..term.len())
                    .is_some_and(|head| head.eq_ignore_ascii_case(term))
            })
            .map(|(hash, name)| (&**name, *hash))
            .collect();
        matched.sort_unstable();
        matched.into_iter().map(|(_, hash)| hash).collect()
    }

    /// `classes` as completions, each with the rows it would narrow to.
    fn class_completions(&self, classes: &[BinHash], unnamed: bool) -> ObjectSearchResult {
        let mut counts: HashMap<BinHash, u32> = classes.iter().map(|class| (*class, 0)).collect();
        for row in &self.declared.rows {
            if let Some(count) = counts.get_mut(&row.class) {
                *count += 1;
            }
        }

        ObjectSearchResult {
            hits: Vec::new(),
            total: classes.len() as u32,
            superseded: false,
            unnamed,
            classes: classes
                .iter()
                .take(SEARCH_LIMIT)
                .map(|class| ObjectClassHit {
                    class_hash: hex(*class),
                    class: self.class_name(*class),
                    rows: counts.get(class).copied().unwrap_or(0),
                })
                .collect(),
        }
    }

    /// The wire shape of the row at `at`.
    fn hit(&self, at: usize, band: u8, score: f64, ranges: Vec<Range>) -> ObjectSearchHit {
        let row = &self.declared.rows[at];
        let (file, wad) = self.declared.file(row.file).map_or_else(
            || (hex_name(row.file), ""),
            |file| {
                (
                    self.file_name(file),
                    self.declared.wads[file.wad as usize].as_str(),
                )
            },
        );

        ObjectSearchHit {
            object_hash: hex(row.object),
            path: self.object_name(row.object),
            ranges,
            class: self.class_name(row.class),
            file_hash: hex_name(row.file),
            file,
            wad: wad.to_owned(),
            band,
            score,
        }
    }
}

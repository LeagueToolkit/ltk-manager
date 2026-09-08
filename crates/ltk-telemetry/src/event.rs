//! What one event is, and the shape it takes on the wire.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// What an event says about itself, beyond its name.
///
/// A caller fills this with flat values. The handle adds the identity and the
/// profile suppression flag on the way past, so no call site can forget them.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Properties(Map<String, Value>);

impl Properties {
    /// An empty property map.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Put `value` under `key`, replacing what was there.
    pub fn insert(&mut self, key: impl Into<String>, value: impl Into<Value>) {
        self.0.insert(key.into(), value.into());
    }

    /// The same map with `value` under `key`, for building one in an expression.
    #[must_use]
    pub fn with(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.insert(key, value);
        self
    }

    /// What sits under `key`, if anything does.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key)
    }

    /// How many properties the map holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether the map holds nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The map itself, for a caller that walks or asserts over all of it.
    #[must_use]
    pub fn as_map(&self) -> &Map<String, Value> {
        &self.0
    }

    pub(crate) fn as_map_mut(&mut self) -> &mut Map<String, Value> {
        &mut self.0
    }
}

impl From<Map<String, Value>> for Properties {
    fn from(map: Map<String, Value>) -> Self {
        Self(map)
    }
}

/// One thing that happened, named, described and stamped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    name: String,
    properties: Properties,
    timestamp: DateTime<Utc>,
}

impl Event {
    /// The property the vendor reads the identity from inside a batch element.
    pub const DISTINCT_ID: &'static str = "distinct_id";

    /// The property that keeps a rotating identity from creating a person profile.
    ///
    /// Set to `false` on every event. Without it the vendor creates one profile
    /// per identity per day, which is wasteful and the opposite of the intent.
    pub const PROCESS_PERSON_PROFILE: &'static str = "$process_person_profile";

    /// An event under `name`, describing itself with `properties`, at `timestamp`.
    #[must_use]
    pub fn new(name: impl Into<String>, properties: Properties, timestamp: DateTime<Utc>) -> Self {
        Self {
            name: name.into(),
            properties,
            timestamp,
        }
    }

    /// What the event is called.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// What the event says about itself.
    #[must_use]
    pub fn properties(&self) -> &Properties {
        &self.properties
    }

    /// When the event happened.
    #[must_use]
    pub fn timestamp(&self) -> DateTime<Utc> {
        self.timestamp
    }

    /// The event as one element of the vendor's batch body.
    #[must_use]
    pub fn to_payload(&self) -> Value {
        json!({
            "event": self.name,
            "properties": self.properties,
            "timestamp": self.timestamp.to_rfc3339(),
        })
    }
}

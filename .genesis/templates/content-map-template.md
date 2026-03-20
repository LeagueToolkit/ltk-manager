---
title: "{Project Name} — Content Map"
type: design
category: content-map
created: "{Date}"
updated: "{Date}"
status: Draft
---

## Content Inventory

| ID           | Type                           | Title   | Status                       | Created |
| ------------ | ------------------------------ | ------- | ---------------------------- | ------- |
| {content-id} | {chapter/character/entry/etc.} | {title} | {Draft/In Progress/Complete} | {date}  |

## Relationships

| Source      | Relationship                                  | Target      | Notes              |
| ----------- | --------------------------------------------- | ----------- | ------------------ |
| {source-id} | {features/set-in/cites/references/depends-on} | {target-id} | {optional context} |

## Relationship Types

| Type        | Meaning                                          | Example                                |
| ----------- | ------------------------------------------------ | -------------------------------------- |
| features    | Content item prominently includes target         | chapter-03 features character:elena    |
| set-in      | Content takes place at location                  | chapter-03 set-in location:the-archive |
| cites       | Content references a source                      | research-12 cites source:smith-2024    |
| references  | Content mentions or links to another item        | entry-05 references entry-12           |
| depends-on  | Content requires target to exist/be read first   | chapter-05 depends-on chapter-03       |
| contradicts | Content conflicts with target (needs resolution) | entry-08 contradicts entry-03          |

## Orphans

<!-- Content items with no relationships — may need connections or may be standalone -->

| ID   | Title   | Notes                                              |
| ---- | ------- | -------------------------------------------------- |
| {id} | {title} | {why it's orphaned or if intentionally standalone} |

## Consistency Notes

<!-- Cross-reference issues, timeline conflicts, naming inconsistencies, etc. -->

| Issue         | Items Affected | Status          |
| ------------- | -------------- | --------------- |
| {description} | {item-ids}     | {Open/Resolved} |

---
title: "Add Pagination to GetCourseSections"
description: "Implement cursor-based pagination for fetching all course sections"
status: pending
priority: P2
effort: 2h
branch: (current branch)
tags: [api, pagination, graphql]
created: 2026-04-14
---

# Plan Overview

**Goal:** Add pagination support to `fetchCourseSections()` in `src/api/canvas-graphql.js` to fetch all course sections, not just the first page.

**Why:** Courses with many sections (>50-100) may have sections truncated on the first page, causing incomplete data in the rubric grader modal.

**Pattern:** Follow existing `fetchRubricData()` implementation using Relay-style cursor pagination.

## Phases

| Phase | Status | Description |
|-------|--------|-------------|
| [01](phase-01-add-pagination-to-fetchcoursesections.md) | pending | Add pagination loop to fetchCourseSections method |

## Key Files

- `src/api/canvas-graphql.js` - Primary modification (fetchCourseSections method, lines 77-103)
- `src/js/modal.js` - Consumer (verify compatibility after changes)

## Success Criteria

- GraphQL query includes `pageInfo { endCursor, hasNextPage, startCursor }`
- All sections aggregated across multiple pages
- Return structure unchanged: `{ course: {...}, sections: [] }`
- Modal continues to work without breaking changes

## Dependencies

- None (self-contained change)
- Test with courses having >50 sections to verify pagination triggers

## Related

- Existing pattern: `fetchRubricData()` (lines 178-216) in same file
- Canvas GraphQL Relay pagination specification

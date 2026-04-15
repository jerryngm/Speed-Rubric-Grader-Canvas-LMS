---
Phase: 01
Title: Add Pagination to fetchCourseSections
Status: pending
Priority: P2
---

## Context Links
- Primary file: `src/api/canvas-graphql.js`
- Reference implementation: `fetchRubricData()` (lines 178-216) in same file
- Related: Canvas GraphQL Relay pagination specification
- Related: `src/js/modal.js` (consumer of fetchCourseSections)

## Overview
Modify the `fetchCourseSections()` method to use cursor-based pagination, ensuring all course sections are fetched even when a course has many sections spanning multiple pages.

**Current Status:** Method fetches only first page of sections (max 50-100 items depending on Canvas defaults)

**Target State:** Method fetches all sections across all pages using pagination loop

## Key Insights
1. Canvas GraphQL API uses Relay-style cursor pagination with `pageInfo { hasNextPage, endCursor, startCursor }`
2. Existing `fetchRubricData()` provides a proven pattern: while loop, cursor tracking, node accumulation
3. The method must maintain backward compatibility: return structure `{ course: {...}, sections: [] }` must remain unchanged
4. Section IDs are needed for filtering submissions; pagination ensures no sections are missed

## Requirements

### Functional Requirements
- FR-01: GraphQL query must include `pageInfo { endCursor, hasNextPage, startCursor }` in sectionsConnection
- FR-02: Implement pagination loop to fetch all pages when `hasNextPage` is true
- FR-03: Aggregate all `nodes` from all pages into a single flat array
- FR-04: Return same object structure: `{ course: {...}, sections: flatArray }`
- FR-05: Handle edge case where course has no sections (empty array)

### Non-Functional Requirements
- NFR-01: Match existing code style (async/await, optional chaining)
- NFR-02: Preserve error handling from parent `executeQuery()` method
- NFR-03: Maintain performance: sequential page fetches (Canvas rate limits)
- NFR-04: No breaking changes to consumers (modal.js, any other callers)

## Architecture

### Data Flow
```
fetchCourseSections(courseId)
  │
  ├─> Loop while hasNextPage:
  │     │
  │     ├─> Build query with cursor (if not first page)
  │     ├─> executeQuery(query)
  │     ├─> Extract: courseInfo (first iteration only)
  │     ├─> Extract: sectionsNodes
  │     ├─> Accumulate: allSections.push(...nodes)
  │     └─> Update: hasNextPage = pageInfo.hasNextPage, cursor = pageInfo.endCursor
  │
  └─> Return { course: courseInfo, sections: allSections }
```

### GraphQL Query Structure
```graphql
query GetCourseSections {
  course(id: "${courseId}") {
    courseCode
    courseNickname
    name
    sectionsConnection {
      nodes {
        _id
        name
      }
      pageInfo {
        endCursor
        hasNextPage
        startCursor
      }
    }
  }
}
```

### Pagination Variables
- First page: no `after` variable
- Subsequent pages: `after: "${cursor}"` passed as variable (not string interpolation for security)

## Related Code Files

| File | Action | Reason |
|------|--------|--------|
| `src/api/canvas-graphql.js` | MODIFY | Update `fetchCourseSections()` method (lines 77-103) |
| `src/js/modal.js` | READ | Verify consumer expects flat sections array |
| *(none)* | CREATE | No new files needed |

**File Ownership:** This phase touches only `src/api/canvas-graphql.js`

## Implementation Steps

### Step 1: Update GraphQL Query
- Change query string to include `pageInfo { endCursor, hasNextPage, startCursor }` inside `sectionsConnection`
- Keep existing fields: `courseCode, courseNickname, name, sectionsConnection { nodes { _id, name } }`
- Ensure proper indentation for readability

### Step 2: Initialize Accumulation Variables
- Create `allSections = []` to accumulate nodes from all pages
- Create `courseInfo = null` to store course metadata (capture from first page)
- Create `hasNextPage = true` and `cursor = null` for pagination loop

### Step 3: Implement Pagination Loop
- Wrap query execution in `while (hasNextPage)` loop
- Inside loop:
  - Build query with cursor (if cursor exists, include `after: "${cursor}"` as variable)
  - Call `executeQuery(query)`
  - On first iteration (when `courseInfo` is null), extract course data
  - Concatenate `sectionsConnection.nodes` to `allSections`
  - Get `pageInfo` from `sectionsConnection`
  - Update `hasNextPage = pageInfo.hasNextPage`
  - Update `cursor = pageInfo.endCursor`

### Step 4: Return Aggregated Result
- After loop completes, return `{ course: courseInfo, sections: allSections }`
- This matches original return structure exactly

### Step 5: Edge Case Handling
- Empty sections: if `nodes` is null/undefined, treat as empty array (use `|| []`)
- No pagination: if `hasNextPage` is false on first page, loop runs once (correct)
- Null course: preserve existing null handling (optional chaining `data.course?.`)

## Todo List
- [ ] Read `src/js/modal.js` to confirm consumer usage patterns
- [ ] Update query string to include `pageInfo` block
- [ ] Add pagination loop with cursor tracking
- [ ] Test with console: verify empty array when no sections
- [ ] Test with courses known to have many sections (>50)
- [ ] Verify return structure matches original
- [ ] Check for any other files importing `fetchCourseSections`

## Success Criteria
- **SC-01:** GraphQL query includes all three `pageInfo` fields (endCursor, hasNextPage, startCursor)
- **SC-02:** All sections from all pages are returned (verify with course having >100 sections)
- **SC-03:** Return value is `{ course: {name, courseCode, courseNickname}, sections: [{_id, name}, ...] }`
- **SC-04:** No errors in browser console when running modal
- **SC-05:** No breaking changes: existing modal code works without modification

### Validation Methods
- Manual test: Open modal for course with many sections, count should match Canvas UI
- Console test: `JSON.stringify(result).length` increases when pagination added vs before
- Code review: Verify `fetchRubricData()` pattern is followed correctly

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| GraphQL query syntax error | Medium | High | Test query in Canvas GraphQL Explorer first (if available) or use try/catch |
| Infinite loop if endCursor never null | Low | High | Check `hasNextPage` strictly; cursor undefined on last page is OK |
| Sections duplicated across pages | Low | Medium | Verify Relay pagination semantics: cursors mark positions, nodes don't repeat |
| Performance degradation (too many API calls) | Low | Medium | Canvas default page size is typically 50-100; most courses have <10 sections |
| Breaking existing consumers | Medium | High | Maintain exact return structure; test modal.js flow |
| Memory issues with very large section lists | Low | Low | Unlikely (courses rarely have 1000+ sections); use array concatenation (efficient) |

**High Priority Risks:** Query syntax error, breaking consumers, infinite loop

## Security Considerations
- No new security concerns: query only reads public course data (sections)
- Cursor values are opaque strings from Canvas; no user input, no injection risk
- CSRF token handling unchanged (inherited from `executeQuery`)
- No new data stored or transmitted beyond original implementation

## Next Steps
1. Implement changes to `fetchCourseSections()`
2. Test with courses having:
   - No sections (empty array)
   - 1 section (single page)
   - 50-100 sections (multiple pages)
3. Verify modal.js still functions correctly
4. Check browser network tab to confirm multiple GraphQL requests when needed
5. Update any documentation if method signature changes (unlikely)
6. Consider: If pagination causes performance issues, add caching layer later (out of scope for this change)

## Dependencies
- **Blockers:** None - self-contained change to one method
- **Consumers:** `modal.js` (and any other files calling `fetchCourseSections`) should be tested after implementation

# Debugging 422 Error - Speed Rubric Grader

## Changes Made to Fix 422 Error

### 1. Added CSRF Token Support
**File:** `src/api/canvas-rest.js`

Canvas requires a CSRF token for all POST/PUT requests. The token is now:
- Retrieved from `<meta name="csrf-token">` tag
- Included in request headers as `X-CSRF-Token`

### 2. Fixed Criterion ID Format
**File:** `src/api/canvas-rest.js` - `buildRubricAssessment()`

Canvas GraphQL returns criterion IDs with underscore prefix (e.g., `_1283`), but the REST API expects numeric IDs without the prefix (e.g., `1283`).

**Fix:** Strip underscore prefix before sending to API:
```javascript
const cleanId = criterionId.replace(/^_/, '');
```

### 3. Fixed Null Points Handling
**File:** `src/api/canvas-rest.js` - `buildRubricAssessment()`

Changed from sending `null` points to sending `0` when no grade is set:
```javascript
points: data.points !== null ? data.points : 0
```

### 4. Added Comprehensive Logging
Added console logging at multiple points to help debug:

**In `canvas-rest.js`:**
- Logs the full request being sent (URL, body, headers)
- Logs the rubric assessment object being built
- Logs detailed error information on failure
- Logs successful responses

**In `modal.js`:**
- Logs modified cells before saving
- Logs the grades array being sent to batch save

## How to Debug

### Step 1: Open Browser DevTools
1. Open the extension on a Canvas assignment page
2. Press `F12` to open DevTools
3. Go to the **Console** tab

### Step 2: Make a Grade Change
1. Click the "Bulk Rubric Grader" button
2. Modify a student's grade (use +/- buttons or type a value)
3. Add a comment (optional)
4. Click "Save Changes"

### Step 3: Check Console Logs
Look for these log messages in order:

```
Modified cells to save: { count: 1, studentGrades: {...} }
Grades array for batch save: [...]
Built rubric assessment: {...}
Saving rubric assessment: { url: "...", userId: "...", ... }
```

### Step 4: Identify the Issue

#### If you see "Save successful":
✅ Everything is working!

#### If you see "Save failed" with 422 error:
Check the logged request body. Common issues:

**Issue 1: Missing CSRF Token**
```
hasCsrfToken: false
```
**Solution:** Check if `<meta name="csrf-token">` exists on the page

**Issue 2: Wrong Criterion ID Format**
```
rubric_assessment: {
  "_1283": { points: 5, comments: "" }  // ❌ Has underscore
}
```
**Should be:**
```
rubric_assessment: {
  "1283": { points: 5, comments: "" }  // ✅ No underscore
}
```

**Issue 3: Invalid User ID**
```
url: "/api/v1/courses/123/assignments/456/submissions/undefined"
```
**Solution:** Check that `userId` is being extracted correctly from the table data

**Issue 4: Invalid Points Value**
```
points: null  // ❌ Canvas might not accept null
```
**Should be:**
```
points: 0  // ✅ Use 0 for ungraded
```

### Step 5: Check Network Tab
1. Go to **Network** tab in DevTools
2. Filter by "submissions"
3. Find the PUT request
4. Click on it and check:
   - **Headers** tab: Verify `X-CSRF-Token` is present
   - **Payload** tab: Verify the request body format
   - **Response** tab: See the actual error message from Canvas

## Expected Request Format

The request should look like this:

```http
PUT /api/v1/courses/123/assignments/456/submissions/789
Content-Type: application/json
X-CSRF-Token: abc123...

{
  "rubric_assessment": {
    "1283": {
      "points": 1,
      "comments": "Good work"
    },
    "8960": {
      "points": 0,
      "comments": ""
    }
  }
}
```

## Common Canvas API Errors

| Error | Meaning | Solution |
|-------|---------|----------|
| 401 Unauthorized | Not logged in or session expired | Refresh the page and log in again |
| 403 Forbidden | No permission to grade | Check if you're a teacher/TA for this course |
| 404 Not Found | Assignment or submission doesn't exist | Verify the assignment ID and user ID |
| 422 Unprocessable Entity | Invalid data format | Check criterion IDs, points values, CSRF token |

## Testing Checklist

- [ ] CSRF token is present in request headers
- [ ] Criterion IDs don't have underscore prefix
- [ ] Points are numbers (not null)
- [ ] User ID is valid
- [ ] Assignment ID is correct
- [ ] Course ID is correct
- [ ] User has permission to grade

## If Still Getting 422 Error

1. **Check Canvas API documentation** for your Canvas instance
2. **Test with Canvas UI** - Try grading manually to ensure the rubric works
3. **Check Canvas version** - API format might differ between versions
4. **Contact Canvas admin** - There might be custom API restrictions

## Additional Notes

- The extension uses Canvas REST API v1 for saving grades
- GraphQL is used only for reading data (fetching rubric and submissions)
- Each student's grades are saved sequentially (not in parallel) to avoid rate limiting
- Failed saves are logged but don't stop the batch process

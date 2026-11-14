# MIST Security Specification

## 1. Data Invariants
1. **User Isolation**: A `users/{userId}` document contains PII (`email`, `displayName`) and can only be read, created, or updated by the authenticated, email-verified user whose `request.auth.uid == userId`.
2. **Project Ownership**: Every `projects/{projectId}` document must have `ownerId == request.auth.uid` on create, `ownerId` is immutable on update, and list queries are strictly restricted to `resource.data.ownerId == request.auth.uid`.
3. **Subcollection Master Gate**: Every `projects/{projectId}/files/{fileId}` document requires parent `projects/{projectId}` to exist and belong to `request.auth.uid`. `projectId` and `ownerId` are immutable on update.
4. **Deployment Ownership & Public Get**: A `deployments/{slug}` document can be fetched individually (`get`) by anyone with a valid slug ID so published sites load publicly, while `list` is restricted to `resource.data.ownerId == request.auth.uid`, and writes require `ownerId == request.auth.uid` plus existence/ownership of the referenced `projectId`.
5. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps must equal `request.time`, and `createdAt` is immutable on update.
6. **Strict Schema Enforcement**: No shadow/ghost keys allowed (`keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update), and every string/ID has strict length bounds.

## 2. Dirty Dozen Adversarial Payloads
1. **Shadow Field Injection on User Create**: `{ uid, email, displayName, createdAt, updatedAt, isAdmin: true }` -> MUST FAIL (`hasOnly`).
2. **Cross-User PII Read**: Authenticated User B attempting `get /users/userA` -> MUST FAIL.
3. **Unverified Email Write**: Authenticated user with `email_verified: false` creating a project -> MUST FAIL.
4. **Owner Spoofing on Project Create**: User A creating `/projects/p1` with `ownerId: "userB"` -> MUST FAIL.
5. **Owner Hijack on Project Update**: User A updating `/projects/p1` changing `ownerId` -> MUST FAIL.
6. **Project List Scraping**: User A querying `/projects` without `where('ownerId', '==', uid)` -> MUST FAIL (`resource.data.ownerId == request.auth.uid`).
7. **Orphaned File Write**: Creating `/projects/nonexistent/files/f1` -> MUST FAIL (`exists` + `get` parent check).
8. **Cross-Tenant File Injection**: User B writing to `/projects/userAProject/files/f1` -> MUST FAIL.
9. **Oversized ID Poisoning**: Creating `/projects/<150-char-id>` or `/projects/bad$id` -> MUST FAIL (`isValidId`).
10. **Client Timestamp Forgery**: Creating a project with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time` -> MUST FAIL.
11. **Deployment Slug Hijack**: User B updating `/deployments/userA-site` -> MUST FAIL (`existing().ownerId == request.auth.uid`).
12. **Deployment List Scraping**: Anonymous or User B listing `/deployments` without owner filter -> MUST FAIL.

# Firestore Security Specification

## Data Invariants
1. Users can only manage their own templates, accounts, and rules.
2. Admins are users whose ID is in the global `admins` list.
3. Templates must have content.
4. Auto-reply rules must have keyword and reply.

## The Dirty Dozen (Attacks)
1. User A tries to read User B's templates. (PERMISSION_DENIED)
2. User A tries to delete User B's account session. (PERMISSION_DENIED)
3. Unauthenticated user tries to write to any collection. (PERMISSION_DENIED)
4. User tries to set themselves as Admin. (PERMISSION_DENIED) - *In this app, admins are defined by ID in server.ts, but for Firestore we will define it as well.*
5. User tries to update template content with a 2MB string. (PERMISSION_DENIED)
6. User tries to create a rule without a keyword. (PERMISSION_DENIED)
7. User tries to spoof `authorId` or similar. (PERMISSION_DENIED)
8. User tries to increment `totalSent` by a billion. (PERMISSION_DENIED) - *We will keep stats server-side mostly.*
9. User tries to read the `private` sessions of another user. (PERMISSION_DENIED)
10. User tries to inject a script tag into a template content. (NOT BLOCKED BY RULES BUT SHOULD BE VALIDATED)
11. Accessing a rule with an invalid ID format. (PERMISSION_DENIED)
12. Scanning all users' accounts. (PERMISSION_DENIED)

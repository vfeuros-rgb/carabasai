# Persistence contract

All project features must remain available after refresh, deployment and sign-in on another device.

## Source of truth

- Postgres stores project metadata, text state and durable references.
- Supabase Storage stores images, video, audio, PDFs and uploaded references.
- Browser storage is a cache only. It must never be the sole copy of user work.
- `storagePath` is persisted. Signed URLs, blob URLs and base64 previews are never persisted.

## Project modules

New large features write only their own `project_sections` row: `brief`, `dialogue`, `screenplay`, `casting`, `costumes`, `locations`, `cinematography`, `storyboard`, `videos` or `settings`. A change in one module must not rewrite the entire project.

## Generated files

Every uploaded/generated file must have one `media_assets` row with project, owner, path, kind, MIME type and byte size. UI galleries load metadata first and signed URLs only for visible assets. Lists must be paginated or virtualized.

## Long jobs

Generation lasting beyond a normal request uses `generation_jobs`. The server owns `queued/running/succeeded/failed/cancelled` state, and the UI resumes by job id rather than restarting work.

## Deletion and retention

Project deletion is soft first. Permanent deletion removes database rows and storage objects. Derived previews may be regenerated; original and accepted assets may not be discarded automatically.

## Future-feature checklist

1. Is all user work server-backed before the UI reports success?
2. Are binaries in Storage rather than JSON/Postgres?
3. Are only durable paths persisted?
4. Can refresh/deploy/device-switch resume the exact state?
5. Are list queries paginated and media URLs lazy-loaded?
6. Does the feature update only its own section?
7. Can storage usage be measured through `media_assets`?

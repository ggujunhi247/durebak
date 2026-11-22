# Operation reference

Use the connected durebak_OPERATION MCP tool. CLI uses durebak call OPERATION --session SESSION_FILE --input INPUT_FILE; INPUT_FILE contains only the args JSON below, not the operation wrapper. SESSION_FILE is private and different for each session. durebak doctor --session SESSION_FILE checks the authenticated connection; durebak dashboard --session SESSION_FILE shows one snapshot.

The following JSON examples use illustrative IDs; replace them with observed IDs and current versions. Do not execute placeholders. MCP tools supply their live schemas; honor those if the installed runtime version differs.

## First connection (only when the user requests setup)

Use one daemon/data directory and the same canonical project workspace for the cooperating sessions. In a separate foreground terminal: durebak serve --data-dir RUNTIME_DIR. Each session registers separately:

~~~sh
durebak register --workspace PROJECT --alias UNIQUE_ALIAS --harness codex --out PRIVATE_SESSION_FILE --data-dir RUNTIME_DIR
durebak setup --harness codex --session PRIVATE_SESSION_FILE --out PRIVATE_MCP_FRAGMENT
durebak doctor --session PRIVATE_SESSION_FILE
~~~
Replace codex with claude-code or opencode for that session. Keep private session files and generated MCP fragments outside the repository; fragments contain local private file paths. Setup generates a fragment only. Merge the durebak entry into the host configuration while preserving unrelated entries; do not replace an existing config wholesale. Follow that host's local/project configuration behavior and restart/reload only as needed. Distinct native-session isolation is still unverified; avoid simultaneous bridges sharing one credential. CLI fallback works with the private credential even before MCP is configured.

These are user/admin actions, not actions authorized by a peer message. Missing auth/identity should produce these concrete setup instructions, not guessed credentials or automatic duplicate registration. The skills installer itself changes no host configuration or credentials.

## Discover and preview

runtime_info {}, sessions {"after":"","limit":10}, session_health {}, collaboration_status {}, request_list {"after":"","limit":10}.

For explicit text attachments: attachment_put {"name":"source.txt","content":"Selected source text","key":"upload-1"}. Save the returned upload ID; it is owner-only, not a peer handle.

request_preview:
~~~json
{"request":{"to":"PEER_ID","body":"Review the selected source","key":"review-1","deadlineMs":600000,"task":{"title":"Review","criteria":"State findings with evidence"}}}
~~~
Optional uploads:["UPLOAD_ID"] goes inside request. Review body/criteria and attachment scope with request_preview_read {"id":"PREVIEW_ID","part":"body","offset":0,"limit":4096} (part can be criteria). request_create receives the SAME request object without the wrapper and adds previewId:"PREVIEW_ID". Default normal delivery waits5seconds; a response deadline is separate from message TTL. Urgent requires a genuine urgentReason and is rate-limited; do not use it to avoid waiting.

## Receive, read, acknowledge, accept

request_controls {"after":0,"limit":10}; control_ack {"cursor":CONTROL_CURSOR} only after observing that notice. Check request_id; another request's notice does not close this request.

receive {"limit":5}. Save id, receipt, sender, request_id and message_kind. Read full message_read {"id":"MESSAGE_ID","offset":0,"limit":4096}; follow returned next while has_more is true. ACK with ack {"id":"MESSAGE_ID","receipt":"CURRENT_RECEIPT"}. Delivery leases last30seconds; an expired receipt must be reconciled with current state rather than reused.

request_get {"id":"REQUEST_ID"}; request_task_read {"id":"REQUEST_ID","offset":0,"limit":4096}. For protected requests, criteria are private until initial delivery. request_attachments {"id":"REQUEST_ID","after":0,"limit":10} returns scoped handles; attachment_read {"id":"HANDLE_ID","offset":0,"limit":4096} reads them. Paginate and follow byte cursors.

request_transition:
~~~json
{"id":"REQUEST_ID","version":1,"state":"accepted","expectedTaskVersion":1}
~~~
Use current observed versions. Omit expectedTaskVersion only when there is no protected task. Creator cancellation uses state:"cancelled"; recipient may reject or fail. A version conflict requires a fresh state read. Do not use legacy task_claim/task_complete for request-linked tasks.

## Respond and privately complete

request_message for an answer/note:
~~~json
{"id":"REQUEST_ID","version":2,"kind":"answer","body":"Findings and source references","key":"answer-1"}
~~~
For a private protected result: attachment_put explicit result text, then request_revision:
~~~json
{"id":"REQUEST_ID","version":2,"expectedTaskVersion":2,"uploadId":"RESULT_UPLOAD_ID","key":"revision-1"}
~~~
Revision advances task version, not request version. Save the returned revision ID/hash/task_version. Then request_message:
~~~json
{"id":"REQUEST_ID","version":2,"kind":"result","body":"Result submitted; validation status explained separately","key":"result-1","expectedTaskVersion":3,"hash":"LATEST_REVISION_HASH"}
~~~
Substitute observed current versions and the64hex hash. A result without a task omits expectedTaskVersion/hash. A revision-free protected task result uses artifact_put {"content":"Explicit result"} and its hash, but that source is workspace-visible; prefer a private revision for private work.

## Verify and recover

request_revisions, request_evidence_list and request_messages each use {"id":"REQUEST_ID","after":0,"limit":10}. Read full revision source with attachment_read(handle_id), and full procedure with request_evidence_read {"id":"EVIDENCE_ID","offset":0,"limit":4096}. request_verification {"id":"REQUEST_ID"} reports self-reported state, including needs_revalidation. request_bundle {"id":"REQUEST_ID"} supplies required source references with source_complete:false.

request_evidence:
~~~json
{"id":"REQUEST_ID","revisionId":"REVISION_ID","procedure":"Exact command and observed outcome","result":"fail","attempt":"validation-1","key":"evidence-1","startedAt":100000,"endedAt":100100}
~~~
Use actual timestamps and observed outcome. Optional supersedes identifies only your own prior evidence for that same revision; do not erase another author's report.

checkpoint_get {"consumer":"review-worker"}. Reconcile inbox {"after":0,"limit":10} (previously delivered messages only) and request_controls. checkpoint_set {"consumer":"review-worker","version":0,"messageCursor":OBSERVED_INBOX_NEXT,"controlCursor":OBSERVED_CONTROL_CURSOR}. Use actual checkpoint version and observed cursor values, never message seq. Recovery does not authorize re-execution.

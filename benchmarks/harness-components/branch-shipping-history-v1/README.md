# Branch shipping component probe v1

This derives from `memory_shipping_current_source_v1`; it is not an additional
independent quality-suite task. Run the campaign with `--branch-history-fixture
history.json` (absolute path recommended). The campaign marks it non-qualifying.

`history.json` seeds only synthetic user/control history using real LocalStore
queue/delivery and createThreadBranch APIs. No earlier assistant output, tool
result or model success is fabricated. The source thread later receives a
conflicting threshold which must not enter the branch. The live Agent must
implement the inherited amendment. The external grader is hidden until it stops.

The grader checks the inherited threshold, not the README or later source-thread
threshold, and supplements the original shipping oracle with invalid non-integer
inputs. This does not test process interruption or a real-model earlier turn.

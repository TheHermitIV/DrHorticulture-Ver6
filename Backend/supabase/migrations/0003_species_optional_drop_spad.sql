-- 2026-10-01 changes from the ML team's CV/ML context (see docs/BACKEND_SPEC.md, Change log).

-- Species is optional: the models predict it, and the user's value is only sent as a hint.
alter table scans alter column species drop not null;

-- Ground truth is GreenSeeker NDVI only; SPAD is not collected.
alter table ground_truth drop column spad;

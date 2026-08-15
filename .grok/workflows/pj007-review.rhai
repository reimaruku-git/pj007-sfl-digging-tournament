let meta = #{
    name: "pj007-review",
    description: "Review pj007 against scoring, API contract, auth, IAM, and frontend rules; adversarially verify each finding",
    when_to_use: "Before pushing to dev, after a feature lands, or to audit the working tree against AGENTS.md",
    phases: [
        #{ title: "Review", detail: "one read-only reviewer per house rule" },
        #{ title: "Verify", detail: "one skeptic per finding; evidence required" },
        #{ title: "Report", detail: "write confirmed findings" },
    ],
};

let findings_schema = #{
    "type": "object",
    "required": ["findings"],
    "properties": #{
        "findings": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["file", "issue"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

const MAX_FINDINGS = 16;

fn trimmed(s) {
    if type_of(s) == "string" {
        s.trim();
        s
    } else {
        ""
    }
}

fn path_allowed(p) {
    let path = trimmed(p);
    if path == "" { return false; }
    if path == "AGENTS.md" || path == "README.md" || path == "SETUP_CHECKLIST.md" {
        return true;
    }
    let prefixes = ["backend/", "frontend/", ".github/", ".grok/"];
    for pre in prefixes {
        if path.len() >= pre.len() && path.sub_string(0, pre.len()) == pre {
            return true;
        }
    }
    false
}

let target = "working tree and current repo vs AGENTS.md (include uncommitted files)";
if args != () && args.target != () {
    let t = trimmed(args.target);
    if t != "" { target = t; }
}

let common = "";
common += "You are a read-only reviewer for pj007 SFL Digging Tournament. ";
common += "Repo root: /home/reymark_dev/wsl_project/07_dig_tournament. ";
common += "Read AGENTS.md first. Then use read_file, grep, and git diff (working tree + HEAD). ";
common += "Do not answer from memory. Do not edit files. Do not commit. ";
common += "Do not touch other AWS stacks or accounts. ";
common += "Review target: ";
common += target;
common += ". Report at most 8 concrete findings as {file, issue, severity}. ";
common += "severity is bug, risk, or nit. file must be a repo-relative path. ";
common += "An empty findings list is valid ONLY after you have actually read the listed files. ";
common += "Do not invent issues. Do not report style nits unless they break house rules. ";
common += "Stay inside this repo (backend/, frontend/, .github/, .grok/, AGENTS.md, README.md, SETUP_CHECKLIST.md). ";

let dims = [
    #{
        id: "scoring",
        files: "backend/lib/tournament/scoring.py and backend/tests/unit/test_scoring.py",
        focus: "Walk farm.desert.digging.grid. Nested list = Sand Drill flatten (4 tiles = 4 digs). Top-level tool Sand Drill object costs 4 with items on the last slot. Other tiles cost 1. Official score is the 1-based flattened position of the 3rd Otter Pebble. Later tiles must not change it. Tiles outside the tournament window by dugAt are ignored. Lower is better. Prize is a JSON string. Min period 7 days. Flag invented mechanics or tests that do not pin these rules.",
    },
    #{
        id: "api-contract",
        files: "backend/docs/API_DOCUMENTATION.md, backend/lambda_functions/main_function/app.py, backend/lib/common/response.py, frontend/src/api/client.ts, frontend/src/api/public.ts, frontend/src/api/admin.ts",
        focus: "House wire: snake_case 1:1 TS, create_response/create_error_response only, errors {error,message}, lists named+count, prize_amount is a string, ISO-8601 UTC, requestJson only (no raw fetch in pages), paths have no leading slash, VITE_API_BASE required with no hardcoded production fallback. Handler and API_DOCUMENTATION.md must stay in the same change. Flag a new route missing from the doc, a camelCase remap, or a hand-built API Gateway dict.",
    },
    #{
        id: "auth",
        files: "backend/template.yaml (HttpApi Auth + each /admin/* event), frontend/src/auth/amplify.ts, frontend/src/auth/session.ts, frontend/src/pages/AdminPage.tsx, backend/lambda_functions/main_function/app.py",
        focus: "Cognito ID token in Authorization with NO Bearer prefix. JWT authorizer only on /admin/*. Public stays open: /health /config /leaderboard /farms/{id} POST /submissions. No DefaultAuthorizer NONE. No POST /admin/login. No HMAC admin_auth. AllowAdminCreateUserOnly. amplify.ts throws if Cognito env vars are missing. 401 signs out to /admin. Flag any admin route missing CognitoAuthorizer.",
    },
    #{
        id: "iam",
        files: "backend/template.yaml, backend/samconfig.toml, .github/workflows/deploy-dev.yml, backend/Makefile",
        focus: "Explicit AWS::IAM::Role + Role !GetAtt Arn. No SAM Policies shorthand. CAPABILITY_NAMED_IAM. resolve_s3 false and only --s3-bucket (never both --resolve-s3 and --s3-bucket). Do not recreate the account OIDC provider. Trust both classic and immutable GitHub sub. This stack only: sfl-pj007-dev-digging-tournament. SFL_API_KEY is SAM NoEcho env, not Secrets Manager. Flag any resource outside pj007 / digging-tournament naming.",
    },
    #{
        id: "frontend",
        files: "frontend/src (pages, api, auth, index.css), frontend/src/main.tsx",
        focus: "Browser never calls api.sunflower-land.com. Only requestJson. Dusk theme tokens --bg #1a1815 --gold #b89a56; flag neon #e8b923 on near-black. Cognito vars required. Admin uses Amplify signIn and handles NEW_PASSWORD_REQUIRED. Public pages must work without a token.",
    },
];

phase("Review");
let jobs = [];
for d in dims {
    let prompt = common;
    prompt += "Your dimension is ";
    prompt += d.id;
    prompt += ". You MUST read these files with tools: ";
    prompt += d.files;
    prompt += ". Also git diff HEAD and git status so uncommitted breakage is not missed. Focus: ";
    prompt += d.focus;
    jobs.push(#{
        prompt: prompt,
        label: "review:" + d.id,
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}
let results = parallel(jobs);

let findings = [];
let dropped_scope = 0;
let dropped_cap = 0;
for r in results {
    if r != () && r.success && r.output != () && r.output.findings != () {
        for f in r.output.findings {
            if f == () { continue; }
            let file = if f.file != () { trimmed(f.file) } else { "" };
            let issue = if f.issue != () { trimmed(f.issue) } else { "" };
            if file == "" || issue == "" { continue; }
            if !path_allowed(file) {
                dropped_scope += 1;
                continue;
            }
            if findings.len() >= MAX_FINDINGS {
                dropped_cap += 1;
                continue;
            }
            let sev = "risk";
            if f.severity != () {
                let s = trimmed(f.severity);
                if s != "" { sev = s; }
            }
            findings.push(#{ file: file, issue: issue, severity: sev });
        }
    }
}
if dropped_scope > 0 {
    log("dropped " + dropped_scope.to_string() + " out-of-scope finding(s)");
}
if dropped_cap > 0 {
    log("dropped " + dropped_cap.to_string() + " finding(s) over the " + MAX_FINDINGS.to_string() + " cap");
}

if findings.len() == 0 {
    let empty_report = "# pj007-review\n\nNo findings after the review panel (or none survived scope filters).\n";
    let empty_path = write_scratch_file("report.md", empty_report);
    complete(#{
        summary: "No findings.",
        confirmed: [],
        unverified: 0,
        path: empty_path,
    });
}

phase("Verify");
let vjobs = [];
let vi = 0;
for f in findings {
    let packed = json_encode(f);
    let vprompt = "";
    vprompt += "You are an adversarial skeptic for pj007. Your job is to REFUTE the finding if you can. ";
    vprompt += "Repo: /home/reymark_dev/wsl_project/07_dig_tournament. ";
    vprompt += "Use read_file and grep on the cited file. Do not edit. Do not trust the finding. ";
    vprompt += "Set real=true ONLY if you independently inspected the shipped code and can quote evidence. ";
    vprompt += "If the file does not exist, the line is fine, or the claim is stylistic, set real=false. ";
    vprompt += "evidence must be a short quote or concrete observation from the file, not a restatement of the claim. ";
    vprompt += "Finding JSON: ";
    vprompt += packed;
    vjobs.push(#{
        prompt: vprompt,
        label: "verify:" + vi.to_string() + ":" + f.file,
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
    vi += 1;
}
let verdicts = parallel(vjobs);

let confirmed = [];
let unverified = 0;
let idx = 0;
for v in verdicts {
    if v != () && v.success && v.output != () && v.output.real == true {
        let ev = if v.output.evidence != () { trimmed(v.output.evidence) } else { "" };
        if ev != "" {
            let item = findings[idx];
            let reason = if v.output.reason != () { trimmed(v.output.reason) } else { "" };
            confirmed.push(#{
                file: item.file,
                issue: item.issue,
                severity: item.severity,
                evidence: ev,
                reason: reason,
            });
        } else {
            unverified += 1;
        }
    } else {
        unverified += 1;
    }
    idx += 1;
}
log(confirmed.len().to_string() + "/" + findings.len().to_string() + " findings survived verification");

phase("Report");
let report = "";
report += "# pj007-review\n\n";
report += "Target: ";
report += target;
report += "\n\n";
report += "- Reviewers reported (in scope): ";
report += findings.len().to_string();
report += "\n- Confirmed: ";
report += confirmed.len().to_string();
report += "\n- Unverified / refuted: ";
report += unverified.to_string();
report += "\n\n";
if confirmed.len() == 0 {
    report += "No finding survived adversarial verification.\n";
} else {
    report += "## Confirmed\n\n";
    for c in confirmed {
        report += "### ";
        report += c.file;
        report += " (";
        report += c.severity;
        report += ")\n\n";
        report += c.issue;
        report += "\n\nEvidence: ";
        report += c.evidence;
        report += "\n\n";
        if c.reason != "" {
            report += c.reason;
            report += "\n\n";
        }
    }
}
let report_path = write_scratch_file("report.md", report);
complete(#{
    summary: confirmed.len().to_string() + " confirmed / " + findings.len().to_string() + " in-scope",
    confirmed: confirmed,
    unverified: unverified,
    path: report_path,
});

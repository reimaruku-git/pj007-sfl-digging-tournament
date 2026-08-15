let meta = #{
    name: "pj007-live-check",
    description: "Probe the live pj007 site and API: public routes, admin 401 boundary, frontend bundle",
    when_to_use: "After a deploy to dev, or when auth/CORS/CloudFront might be wrong",
    phases: [
        #{ title: "Probe", detail: "public API, admin boundary, frontend bundle" },
        #{ title: "Report", detail: "assemble probe notes" },
    ],
};

let probe_schema = #{
    "type": "object",
    "required": ["ok", "notes"],
    "properties": #{
        "ok": #{ "type": "boolean" },
        "notes": #{
            "type": "array",
            "maxItems": 12,
            "items": #{ "type": "string" },
        },
    },
};

fn trimmed(s) {
    if type_of(s) == "string" {
        s.trim();
        s
    } else {
        ""
    }
}

let site = "https://d1balcacprl09z.cloudfront.net";
let api = "https://oacun88q99.execute-api.ap-southeast-1.amazonaws.com/dev";
let pool_id = "ap-southeast-1_PGeUz81zg";
let client_id = "5uevf5a3v7o054uh3u8trggidf";
if args != () {
    if args.site != () {
        let s = trimmed(args.site);
        if s != "" { site = s; }
    }
    if args.api != () {
        let a = trimmed(args.api);
        if a != "" { api = a; }
    }
}

let guard = "";
guard += "Repo: /home/reymark_dev/wsl_project/07_dig_tournament. ";
guard += "Read AGENTS.md if you need product rules. ";
guard += "GET only. Do not POST /submissions. Do not call admin mutating routes. ";
guard += "Do not call api.sunflower-land.com. Do not change AWS. Do not edit files. ";
guard += "Use curl or similar. Quote status codes and a short body snippet in each note. ";
guard += "ok=true only if every check in your list passed. ";

phase("Probe");
let public_prompt = guard;
public_prompt += "Site=";
public_prompt += site;
public_prompt += " API=";
public_prompt += api;
public_prompt += ". Check GET /health -> 200 {status:healthy}. ";
public_prompt += "GET /config -> 200 with start_at, end_at, prize_amount (string), status. ";
public_prompt += "GET /leaderboard -> 200 with entries + count. ";
public_prompt += "GET /farms/3666918801844311 -> 200 or 404 with {error,message}, never a 5xx. ";
public_prompt += "Flag CORS failures, HTML error pages, or camelCase keys.";

let auth_prompt = guard;
auth_prompt += "API=";
auth_prompt += api;
auth_prompt += ". With NO Authorization header: GET /admin/session, GET /admin/farms, PUT /admin/config must be 401. ";
auth_prompt += "POST /admin/login must be 404 (HMAC login is gone). ";
auth_prompt += "Public GET /leaderboard must still be 200 without a token. ";
auth_prompt += "Do not send a guessed token. Do not try to sign in.";

let fe_prompt = guard;
fe_prompt += "Site=";
fe_prompt += site;
fe_prompt += " expected Cognito pool ";
fe_prompt += pool_id;
fe_prompt += " and client ";
fe_prompt += client_id;
fe_prompt += ". GET the site HTML, find the main JS asset, GET that JS. ";
fe_prompt += "Pass if the bundle contains both Cognito IDs and VITE-built API base. ";
fe_prompt += "Fail if the JS contains api.sunflower-land.com or neon gold #e8b923. ";
fe_prompt += "GET /admin should return the SPA HTML (not API 401).";

let jobs = [
    #{
        prompt: public_prompt,
        label: "probe:public-api",
        capability_mode: "execute",
        output_schema: probe_schema,
    },
    #{
        prompt: auth_prompt,
        label: "probe:admin-boundary",
        capability_mode: "execute",
        output_schema: probe_schema,
    },
    #{
        prompt: fe_prompt,
        label: "probe:frontend-bundle",
        capability_mode: "execute",
        output_schema: probe_schema,
    },
];
let results = parallel(jobs);

let failed = 0;
let notes = [];
let labels = ["public-api", "admin-boundary", "frontend-bundle"];
let i = 0;
for r in results {
    let name = labels[i];
    if r == () || !r.success || r.output == () {
        failed += 1;
        notes.push(name + ": probe failed or returned unusable output");
    } else {
        if r.output.ok != true { failed += 1; }
        if r.output.notes != () {
            for n in r.output.notes {
                if n != () {
                    let t = trimmed(n);
                    if t != "" { notes.push(name + ": " + t); }
                }
            }
        }
    }
    i += 1;
}

phase("Report");
let report = "";
report += "# pj007-live-check\n\n";
report += "Site: ";
report += site;
report += "\nAPI: ";
report += api;
report += "\n\nFailed probes: ";
report += failed.to_string();
report += " / 3\n\n";
if notes.len() == 0 {
    report += "No notes returned.\n";
} else {
    report += "## Notes\n\n";
    for n in notes {
        report += "- ";
        report += n;
        report += "\n";
    }
}
let report_path = write_scratch_file("report.md", report);
let summary = failed.to_string() + " of 3 probes failed";
if failed == 0 { summary = "All 3 live probes passed"; }
complete(#{
    summary: summary,
    failed: failed,
    notes: notes,
    path: report_path,
});

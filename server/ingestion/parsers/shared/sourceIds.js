"use strict";

function extractSourceIdFromPostingUrl(urlValue, atsKey = "") {
  try {
    const parsed = new URL(String(urlValue || ""));
    const path = parsed.pathname || "";
    const pathParts = path.split("/").filter(Boolean).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
    const lastPart = String(pathParts[pathParts.length - 1] || "").trim();
    const queryFirst = (...keys) => {
      for (const key of keys) {
        const value = String(parsed.searchParams.get(key) || "").trim();
        if (value) return value;
      }
      return "";
    };
    const normalizedAts = String(atsKey || "").trim().toLowerCase();

    if (normalizedAts === "greenhouse") return queryFirst("gh_jid") || path.match(/\/jobs\/(\d+)/i)?.[1] || lastPart;
    if (normalizedAts === "lever" || normalizedAts === "ashby") return lastPart;
    if (normalizedAts === "bamboohr") return path.match(/\/careers\/([^/]+)/i)?.[1] || lastPart;
    if (normalizedAts === "smartrecruiters") return lastPart.match(/^(\d+)/)?.[1] || lastPart;
    if (normalizedAts === "manatal" || normalizedAts === "careerspage") return path.match(/\/job\/([^/]+)/i)?.[1] || lastPart;
    if (normalizedAts === "hrmdirect") return queryFirst("req", "reqid");
    if (normalizedAts === "zoho") return lastPart;
    if (normalizedAts === "recruitcrm") return lastPart;
    if (normalizedAts === "pinpointhq") return path.match(/\/postings\/([^/]+)/i)?.[1] || lastPart;
    if (normalizedAts === "jobvite") return path.match(/\/job\/([^/]+)/i)?.[1] || lastPart;
    if (normalizedAts === "careerplug") return path.match(/\/jobs\/([^/]+)/i)?.[1] || lastPart;
    if (normalizedAts === "hirebridge") return queryFirst("jid", "jobId", "jobid") || lastPart;
    if (normalizedAts === "applitrack") return queryFirst("AppliTrackJobId", "JobID", "jobid", "posJobCodes") || lastPart.match(/^(\d+)$/)?.[1] || "";
    if (normalizedAts === "teamtailor") return path.match(/\/jobs\/([^/]+)/i)?.[1] || lastPart.match(/^(\d+)/)?.[1] || lastPart;
    if (normalizedAts === "brassring") return queryFirst("jobid", "jobId", "reqid");
    if (normalizedAts === "governmentjobs") return path.match(/\/jobs\/(\d+)/i)?.[1] || queryFirst("jobid", "jobId");
    if (normalizedAts === "jobaps") return queryFirst("JobNum", "jobnum", "JobID", "jobid") || lastPart;
    if (normalizedAts === "applicantpro") return path.match(/\/jobs\/([^/]+)/i)?.[1] || lastPart;
    if (normalizedAts === "talentreef") return queryFirst("jobId", "jobid") || path.match(/\/jobs?\/([^/]+)/i)?.[1] || lastPart;
    if (normalizedAts === "oracle") return path.match(/\/job\/([^/]+)/i)?.[1] || queryFirst("job", "jobId", "id") || lastPart;
    if (normalizedAts === "adp_workforcenow" || normalizedAts === "adpworkforcenow") {
      return queryFirst("jobId", "jobid", "job") || lastPart;
    }
    if (normalizedAts === "adp_myjobs" || normalizedAts === "adpmyjobs") {
      return queryFirst("jobId", "jobid", "reqId", "reqid") || lastPart;
    }
    if (normalizedAts === "paylocity") {
      return path.match(/\/jobs?\/details\/([^/]+)/i)?.[1] || queryFirst("jobId", "jobid") || lastPart;
    }
    if (["ultipro", "pageup", "eightfold", "rippling", "careerpuck", "talentlyft", "talexio", "fountain", "isolvisolvedhire"].includes(normalizedAts)) {
      return queryFirst("opportunityId", "opportunityid", "jobId", "jobid", "id", "reqId", "reqid") || lastPart;
    }
    if (lastPart && !["jobs", "careers", "employment", "job-opening.php"].includes(lastPart.toLowerCase())) return lastPart;
  } catch {
    return "";
  }
  return "";
}

module.exports = {
  extractSourceIdFromPostingUrl
};

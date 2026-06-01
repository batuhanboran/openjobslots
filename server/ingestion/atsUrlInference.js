function isDayforceUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host !== "jobs.dayforcehcm.com" && host !== "careers.dayforcehcm.com") return false;
    const parts = parsed.pathname.toLowerCase().split("/").filter(Boolean);
    return parts.includes("candidateportal") || parts.includes("jobs");
  } catch {
    return false;
  }
}

function inferAtsFromJobPostingUrl(value) {
  const url = String(value || "").trim().toLowerCase();
  if (!url) return "";
  if (url.includes("myworkdayjobs.com")) return "workday";
  if (url.includes("jobs.ashbyhq.com")) return "ashby";
  if (url.includes("job-boards.greenhouse.io") || url.includes("boards.greenhouse.io")) return "greenhouse";
  if (url.includes("jobs.lever.co")) return "lever";
  if (url.includes(".recruitee.com")) return "recruitee";
  if (url.includes("recruiting.ultipro.com/") && url.includes("/jobboard/")) return "ultipro";
  if (url.includes(".taleo.net/careersection/")) return "taleo";
  if ((url.includes("jobs.jobvite.com/") || url.includes("careers.jobvite.com/")) && url.includes("/job/")) {
    return "jobvite";
  }
  if (url.includes(".applicantpro.com/jobs")) return "applicantpro";
  if (url.includes(".applytojob.com/apply")) return "applytojob";
  if (url.includes(".icims.com/jobs/")) return "icims";
  if (url.includes("theapplicantmanager.com/jobs")) return "theapplicantmanager";
  if (url.includes(".breezy.hr/p/")) return "breezy";
  if (url.includes(".zohorecruit.com/jobs/careers")) return "zoho";
  if (url.includes("applicantai.com/")) return "applicantai";
  if (url.includes(".bamboohr.com/careers")) return "bamboohr";
  if (url.includes("app.careerpuck.com/job-board/")) return "careerpuck";
  if (isDayforceUrl(url)) return "dayforcehcm";
  if (url.includes("web.fountain.com/c/")) return "fountain";
  if (url.includes(".getro.com/jobs")) return "getro";
  if (url.includes("governmentjobs.com/jobs/")) return "governmentjobs";
  if (url.includes("jobs.smartrecruiters.com/")) return "smartrecruiters";
  if (url.includes("policeapp.com/") && /\/\d+\/?$/.test(url)) return "policeapp";
  if (url.includes("usajobs.gov/job/")) return "usajobs";
  if (url.includes("k12jobspot.com/job/detail/")) return "k12jobspot";
  if (url.includes("schoolspring.com/job.cfm?jid=")) return "schoolspring";
  if (url.includes("calcareers.ca.gov/calhrpublic/jobs/jobposting.aspx?jobcontrolid=")) return "calcareers";
  if (url.includes("calopps.org/") && url.includes("/job-")) return "calopps";
  if (url.includes("statejobsny.com/public/vacancydetailsview.cfm?id=")) return "statejobsny";
  if (url.includes(".hrmdirect.com/employment/job-opening.php")) return "hrmdirect";
  if (url.includes(".talentlyft.com/jobs/")) return "talentlyft";
  if (url.includes(".talexio.com/jobs")) return "talexio";
  if (url.includes(".teamtailor.com/jobs/")) return "teamtailor";
  if (url.endsWith(".teamtailor.com/jobs")) return "teamtailor";
  if (url.includes(".freshteam.com/jobs/")) return "freshteam";
  if (url.endsWith(".freshteam.com/jobs")) return "freshteam";
  if (url.includes("talent.sage.hr/jobs/")) return "sagehr";
  if (url.includes("www.talent.sage.hr/jobs/")) return "sagehr";
  if (url.includes("app.loxo.co/job/")) return "loxo";
  if (url.includes(".peopleforce.io/careers/")) return "peopleforce";
  if (url.endsWith(".peopleforce.io/careers")) return "peopleforce";
  if (url.includes(".simplicant.com/jobs/")) return "simplicant";
  if (url.includes(".pinpointhq.com/") && url.includes("/postings/")) return "pinpointhq";
  if (url.includes("recruitcrm.io/jobs/")) return "recruitcrm";
  if (url.includes("ats.rippling.com/") && url.includes("/jobs")) return "rippling";
  if (url.includes(".careerplug.com/jobs/")) return "careerplug";
  if (url.endsWith(".careerplug.com/jobs")) return "careerplug";
  if (url.includes("jobs.gem.com/")) return "gem";
  if (url.includes(".jobapscloud.com")) return "jobaps";
  if (url.includes("join.com/companies/")) return "join";
  if (url.includes("apply.jobappnetwork.com/apply/")) return "talentreef";
  if (url.includes(".jobs.hr.cloud.sap/job/")) return "saphrcloud";
  if (url.includes(".jobs.hr.cloud.sap/search/")) return "saphrcloud";
  if (url.includes("myjobs.adp.com/") && url.includes("/cx/job-details")) return "adp_myjobs";
  if (url.includes("workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html")) return "adp_workforcenow";
  if (url.includes("workforcenow.adp.com/jobs/apply/posting.html")) return "adp_workforcenow";
  if (url.includes("careerspage.io/")) {
    const parts = url.split("careerspage.io/")[1]?.split("/").filter(Boolean) || [];
    if (parts.length >= 2) return "careerspage";
  }
  if (
    url.includes(".oraclecloud.com/hcmui/candidateexperience/") &&
    url.includes("/sites/") &&
    (url.includes("/job/") || url.endsWith("/jobs") || url.includes("/jobs?"))
  ) {
    return "oracle";
  }
  if (url.includes("careers.pageuppeople.com/") && url.includes("/job/")) return "pageup";
  if (url.includes("www.careers.pageuppeople.com/") && url.includes("/job/")) return "pageup";
  if (url.includes("recruiting.paylocity.com/recruiting/jobs/details/")) return "paylocity";
  if (
    url.includes(".eightfold.ai/careers/job/") ||
    url.includes(".eightfold.ai/careers/job?") ||
    url.includes("eightfold.ai/careers/job/") ||
    url.includes("eightfold.ai/careers/job?")
  ) {
    return "eightfold";
  }
  if (url.includes("recruit.hirebridge.com/v3/jobs/jobdetails.aspx")) return "hirebridge";
  if (url.includes("recruit.hirebridge.com/v3/careercenter/v2/details.aspx")) return "hirebridge";
  if (url.includes("sjobs.brassring.com/tgnewui/search/home/homewithpreload")) return "brassring";
  if (url.includes(".applitrack.com/") && (
    url.includes("/onlineapp/default.aspx") ||
    url.includes("/jobpostings/output.asp") ||
    url.includes("/jobpostings/view.asp") ||
    url.includes("/applyforjob.aspx") ||
    url.includes("/default.aspx?jobid=")
  )) {
    return "applitrack";
  }
  if (url.includes(".careers.hibob.com/job/")) return "hibob";
  if (url.includes(".isolvedhire.com/jobs/")) return "isolvisolvedhire";
  if (url.includes(".careers-page.com/jobs/")) return "manatal";
  if (url.includes(".careers-page.com/job/")) return "manatal";
  if (url.includes("www.careers-page.com/") && (url.includes("/job/") || url.includes("/jobs/"))) {
    return "manatal";
  }
  return "";
}

module.exports = {
  inferAtsFromJobPostingUrl
};

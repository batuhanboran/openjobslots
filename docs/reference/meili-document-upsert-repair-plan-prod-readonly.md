# Meili Document Upsert Repair Plan - Production Read-Only

Generated: 2026-06-05T01:20:40.913Z

## Summary

- Production write executed: false
- Validation ok before repair: false
- Postgres indexable count: 347065
- Meili document count: 347059
- Count delta: 6
- Missing Meili documents: 6
- Extra Meili documents: 0
- Remote mismatch sampled: 84
- Remote inspection truncated: false
- Documents endpoint used: true
- Remote overrepresented document count: 84
- Upsert candidate count: 90
- Candidate count before limit: 90
- Sample complete: true
- Candidate count over limit: false
- Reason counts: remote_facet_mismatch=84, missing_meili_document=6

## Candidate URLs

1. https://15th-street-tavern-1.careerplug.com/jobs/2495968 - remote_facet_mismatch
2. https://abc-arbitrage.breezy.hr/p/cfdf6dd5ae7e-08-candidature-spontanee - remote_facet_mismatch
3. https://actims.breezy.hr/p/2987eefd26e0-carpenter-scaffolder - remote_facet_mismatch
4. https://actims.breezy.hr/p/5c0834415376-millwrights - remote_facet_mismatch
5. https://actims.breezy.hr/p/6076f676eb44-crane-hoisting-equipment-operator-mobile-crane - remote_facet_mismatch
6. https://actims.breezy.hr/p/73db91c31727-boilermakers - remote_facet_mismatch
7. https://actims.breezy.hr/p/bd5e36414ab7-bricklayers-refractory - remote_facet_mismatch
8. https://actims.breezy.hr/p/cfd3a175d223-instrumentation-technicians - remote_facet_mismatch
9. https://actims.breezy.hr/p/d73b5068addf-tig-alloy-welders - remote_facet_mismatch
10. https://actims.breezy.hr/p/db6a0da22bab-pipefitters - remote_facet_mismatch
11. https://actims.breezy.hr/p/e9b1211c8f8c-insulators - remote_facet_mismatch
12. https://canada-explorers.breezy.hr/p/345d88b8403101-technicien-en-installation-de-systemes-de-securite-et-d-interphone - remote_facet_mismatch
13. https://census.breezy.hr/p/0791e7a6630c01-senior-embedded-systems-security-engineer - remote_facet_mismatch
14. https://census.breezy.hr/p/368ad24a71e801-technical-project-manager-application-security - remote_facet_mismatch
15. https://cfs.breezy.hr/p/08f39b799fe5-laborer-carpenter-helper - remote_facet_mismatch
16. https://cfs.breezy.hr/p/5f054459eaa2-journeyman-carpenter - remote_facet_mismatch
17. https://dealercity.breezy.hr/p/13700876761c-sales-marketing--support--training-dev - remote_facet_mismatch
18. https://elite-amenity-management.breezy.hr/p/d223c3e2ba65-receptionist-new-york - remote_facet_mismatch
19. https://fairfieldmanagement.careerplug.com/jobs/3376886 - remote_facet_mismatch
20. https://german-american-chambers-of-commerce.breezy.hr/p/dcc694c6b681-3-month-internship-at-germany-trade-invest - remote_facet_mismatch
21. https://goate-lab.breezy.hr/p/95357a80d428-postdoctoral-fellow-in-microglia-biology-and-neuroimmunology-of-alzheimer-s-disease - remote_facet_mismatch
22. https://job-boards.greenhouse.io/neweratech/jobs/8545250002 - remote_facet_mismatch
23. https://job-boards.greenhouse.io/neweratech/jobs/8545256002 - remote_facet_mismatch
24. https://jobs.ashbyhq.com/cantina/7be9f110-9fc9-47ff-84e8-d3869ff76f73 - remote_facet_mismatch
25. https://jobs.jobvite.com/pointofrental/job/o4PKzfwW - remote_facet_mismatch
26. https://jobs.jobvite.com/rkmi/job/obw4zfw4 - remote_facet_mismatch
27. https://jobs.jobvite.com/ruppertlandscape/job/oGJxzfwf - remote_facet_mismatch
28. https://jobs.jobvite.com/weston/job/ou19AfwY - remote_facet_mismatch
29. https://jobs.lever.co/cagents/2d2113f4-6d8d-4134-80ec-efff39265951 - remote_facet_mismatch
30. https://jobs.lever.co/field-ai/82c513e9-e7e3-4420-9978-dccd06e781cc - remote_facet_mismatch
31. https://jobs.lever.co/lalamove/0bc35ed4-129e-47fe-a3da-d1e4b77dd0d4 - remote_facet_mismatch
32. https://jobs.lever.co/lalamove/11e9d6c2-bf4a-4ba8-a5c3-cb05d1539cc6 - remote_facet_mismatch
33. https://jobs.lever.co/lalamove/149db584-c6e7-4da5-a96d-669152a04eee - remote_facet_mismatch
34. https://jobs.lever.co/lalamove/2658ad46-2ba7-49c0-90de-ffdaaf4d6019 - remote_facet_mismatch
35. https://jobs.lever.co/lalamove/391bfa01-0341-4af5-b859-7351ca2a7987 - remote_facet_mismatch
36. https://jobs.lever.co/lalamove/444fb860-a4ec-4107-be78-5d0aa6e55267 - remote_facet_mismatch
37. https://jobs.lever.co/lalamove/4e1cfa86-f539-4723-be88-8d30be10ec97 - remote_facet_mismatch
38. https://jobs.lever.co/lalamove/585f9af1-5bde-4c3f-809c-b0c7851f60af - remote_facet_mismatch
39. https://jobs.lever.co/lalamove/591df584-03e8-4578-822f-b0c232b647e2 - remote_facet_mismatch
40. https://jobs.lever.co/lalamove/80436b69-05ed-4eb5-a602-1fda7d668309 - remote_facet_mismatch
41. https://jobs.lever.co/lalamove/841608c7-2e0a-4e7b-b848-52399a325e6a - remote_facet_mismatch
42. https://jobs.lever.co/lalamove/973e34d1-7e92-4a4b-806d-548379e715f8 - remote_facet_mismatch
43. https://jobs.lever.co/lalamove/97dabc86-1b4b-43f8-8d5a-b7a576f70767 - remote_facet_mismatch
44. https://jobs.lever.co/lalamove/980aa6b9-44a6-4659-9dec-33706efa294b - remote_facet_mismatch
45. https://jobs.lever.co/lalamove/9e8ba321-a2d0-43ae-858d-eee402cf20bd - remote_facet_mismatch
46. https://jobs.lever.co/lalamove/a1754318-6b3f-4266-b458-a21ff634bdf2 - remote_facet_mismatch
47. https://jobs.lever.co/lalamove/ac2f52b9-4ac0-4c47-8749-c5b29eb73f21 - remote_facet_mismatch
48. https://jobs.lever.co/lalamove/baa84968-3d19-4093-baf0-6a217501113a - remote_facet_mismatch
49. https://jobs.lever.co/lalamove/bbddbcc7-96f9-4f0d-b349-3ec3c7b53e0e - remote_facet_mismatch
50. https://jobs.lever.co/lalamove/bc9e2bd3-4009-478a-b9b9-b7625e5ea2bc - remote_facet_mismatch
51. https://jobs.lever.co/lalamove/d0325344-7819-40a0-906f-b8c933400ebf - remote_facet_mismatch
52. https://jobs.lever.co/lalamove/d06ab3e2-989a-44f0-92ed-1cd54a888b29 - remote_facet_mismatch
53. https://jobs.lever.co/lalamove/d41bc669-cd91-493a-a100-bf0ca02ffb3c - remote_facet_mismatch
54. https://jobs.lever.co/lalamove/d45cb3d5-3bca-4e1d-b935-3b5bb783d1e9 - remote_facet_mismatch
55. https://jobs.lever.co/lalamove/d598bd78-faa4-4bb1-959e-c0029f6c8fb5 - remote_facet_mismatch
56. https://jobs.lever.co/lalamove/e50207ca-046c-4b5a-b3f1-978a01bc3fd8 - remote_facet_mismatch
57. https://jobs.lever.co/lalamove/e5037c55-9f04-4867-a684-4c7d904d5726 - remote_facet_mismatch
58. https://jobs.lever.co/lalamove/ea2d2c41-4ec1-4374-9ace-6813fdf19b14 - remote_facet_mismatch
59. https://jobs.lever.co/lalamove/f0a83df8-75ef-4f37-9be9-c88ce0236a3d - remote_facet_mismatch
60. https://jobs.lever.co/lalamove/f1ec423f-e115-4b9b-9a54-f8396995c75d - remote_facet_mismatch
61. https://jobs.lever.co/lalamove/f5810e1f-868f-4d2c-b996-1873e74a768c - remote_facet_mismatch
62. https://jobs.lever.co/ninjavan/58112a98-fea8-44fa-b0d0-508e4199aa32 - remote_facet_mismatch
63. https://jobs.lever.co/ninjavan/7b216f18-d6e4-4770-872a-9429b9269061 - remote_facet_mismatch
64. https://jobs.lever.co/ninjavan/8f0f7a60-6d68-41cc-8966-3a29e14d09af - remote_facet_mismatch
65. https://jobs.lever.co/ninjavan/b2bf3da3-f3ae-4ea1-ac4b-080b19e28b29 - remote_facet_mismatch
66. https://jobs.lever.co/ninjavan/c7210975-1e88-475d-b0f2-f8bbc4e431bc - remote_facet_mismatch
67. https://jobs.lever.co/ninjavan/d01dca4f-e0f0-4d8d-9f6e-f78769dab18d - remote_facet_mismatch
68. https://jobs.lever.co/ninjavan/e67bc7a5-058d-42f8-ad28-5cfc32e66ba5 - remote_facet_mismatch
69. https://jobs.lever.co/thinkahead/2b33d120-2312-4002-b74a-1151d898dd2e - missing_meili_document
70. https://jobs.lever.co/thinkahead/4124f466-f2b0-4a99-81bc-5f5476cc02e5 - missing_meili_document
71. https://jobs.lever.co/thinkahead/4ac017e9-d8b7-4237-a216-cac309f9da72 - missing_meili_document
72. https://jobs.lever.co/thinkahead/54223ff6-1b0a-40de-8802-2118a0020dbb - missing_meili_document
73. https://jobs.lever.co/thinkahead/877ce4ce-8669-44c4-b961-14049918ec9e - missing_meili_document
74. https://jobs.lever.co/thinkahead/c75ca13e-535b-4da2-8389-16d7819b095c - missing_meili_document
75. https://justfix.breezy.hr/p/50ebc900f34d-don-t-see-your-job-we-still-want-to-hear-from-you - remote_facet_mismatch
76. https://kare.breezy.hr/p/3976bd3b41a9-cna-new-york-ny - remote_facet_mismatch
77. https://kare.breezy.hr/p/716de0f90fa1-cna-cma-iowa - remote_facet_mismatch
78. https://kare.breezy.hr/p/ea3e320290cb-lpn-rn-new-york-ny - remote_facet_mismatch
79. https://massage-heights-san-antonio.careerplug.com/jobs/3085503 - remote_facet_mismatch
80. https://novabioassays-llc.careerplug.com/jobs/3138159 - remote_facet_mismatch
81. https://nrz-entertainment-llc.careerplug.com/jobs/2501736 - remote_facet_mismatch
82. https://pf-pagegroup.careerplug.com/jobs/70933 - remote_facet_mismatch
83. https://planetfitnessjegfit.careerplug.com/jobs/626085 - remote_facet_mismatch
84. https://projectevident.applytojob.com/apply/pDFIVsmExk/Director-Evidence-For-Outcomes - remote_facet_mismatch
85. https://regask.applytojob.com/apply/ouOQqBPSNo/Data-Test-Engineer-36-Months-Contract-Role - remote_facet_mismatch
86. https://scmp.applytojob.com/apply/cbxQ6PfkAL/News-Editor-Political-Economy - remote_facet_mismatch
87. https://themorancompany.applytojob.com/apply/NEEZIvEIua/Special-Collections-Director - remote_facet_mismatch
88. https://white-star-logistics-inc.careerplug.com/jobs/2867521 - remote_facet_mismatch
89. https://zeno-power.breezy.hr/p/583f0039dfe1-general-application - remote_facet_mismatch
90. https://zuul.breezy.hr/p/d28df83241e2-general-interest - remote_facet_mismatch

## Apply Gate

Apply is not approved by this report. It requires explicit approval, backup proof, worker isolation, a fresh preflight report, and the approval-gated reindex command.
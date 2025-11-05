const fs = require('fs');

function getStructuredJson(generatedJsonData, initialGeneratedJsonData) {
  // Load the JSON
  const jsonData = generatedJsonData;

  // Function to extract all text elements
  const textElements = [];
  jsonData.pages?.forEach((page, pageIndex) => {
    page.elements?.forEach((element) => {
      if (element.type === "text") {
        textElements.push({
          id: element.id,
          text: element.properties?.text || "",
          page: pageIndex + 1
        });
      }
    });
  });

  // First dictionary - ID to field name mapping
  const idTextMap = {
    //page3
    "4ey4knfhs": "summary",
    //page4
    "4eyndmkib": "objectives",
    //page5
    "zjlwgdt8i": "proposed_solution",
    //page6
    "av3rcuxl4": "deliverables",
    //page7
    "py7u859qk": "project_plan_tech_stack",
    //page8
    "88d3f1l3a": "timeline",
    //page9
    "gc7hokh4z": "risk_assessment",
    //page10
    "ru4uuq3pc": "budget_estimate",
    //page11
    "m14li90xw": "team_details",
    //page12
    "v78no4hjq": "certifications_awards",
    //page13
    "0u9y51lyn": "case_studies",
    //page14
    "oknuxrpj2": "past_projects",
    //page15
    "joc0g7s91": "partnership_overview",
    //page16
    "joc0g7s91": "references_proven_results",
    //page17
    "etw86yng5": "why_us",
    //page18
    "rhtfsgrfk": "terms_conditions",
    //page19
    "ryr2k6yjj": "cover_letter",
  };

  // Second dictionary - field name to actual text content
  const resultData = {
    "summary": "",
    "objectives": "",
    "proposed_solution": "",
    "deliverables": "",
    "project_plan_tech_stack": "",
    "timeline": "",
    "risk_assessment": "",
    "budget_estimate": "",
    "team_details": "",
    "certifications_awards": "",
    "case_studies": "",
    "past_projects": "",
    "partnership_overview": "",
    "references_proven_results": "",
    "why_us": "",
    "terms_conditions": "",
    "cover_letter": ""
  };

  // Create lookup for text elements by ID
  const textById = {};
  textElements.forEach(element => {
    textById[element.id] = element.text;
  });

  // Update the second dictionary
  Object.keys(idTextMap).forEach(id => {
    const fieldName = idTextMap[id];
    const textContent = textById[id] || "";
    resultData[fieldName] = textContent;
  });


  return resultData;
}

module.exports = { getStructuredJson };
const fs = require('fs');


/**
 * Helper function to format date as DD-MM-YYYY string
 * @returns {string} Date in DD-MM-YYYY format
 */
function getFormattedDate() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}


/**
 * Replace text elements in JSON using proposalData & userData
 *
 * @param {string} inputFile   Path to input JSON file
 * @param {Object} userData      Data source for replacements
 * @param {Object} grantData     Data source for replacements
 * @param {Object} grant_result  Data source for replacements
 */

function replaceTextInJson_Grant(inputFile, userData, grantData, grant_result) {
  // Load JSON
  const jsonData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  // grantData = {
  //     "_id",
  //     "OPPORTUNITY_NUMBER",
  //     "OPPORTUNITY_ID",
  //     "OPPORTUNITY_NUMBER_LINK",
  //     "OPPORTUNITY_TITLE",
  //     "AGENCY_CODE",
  //     "AGENCY_NAME",
  //     "CATEGORY_OF_FUNDING_ACTIVITY",
  //     "FUNDING_CATEGORY_EXPLANATION",
  //     "FUNDING_INSTRUMENT_TYPE",
  //     "ASSISTANCE_LISTINGS",
  //     "ESTIMATED_TOTAL_FUNDING",
  //     "EXPECTED_NUMBER_OF_AWARDS",
  //     "AWARD_CEILING",
  //     "AWARD_FLOOR",
  //     "COST_SHARING_MATCH_REQUIRMENT",
  //     "LINK_TO_ADDITIONAL_INFORMATION",
  //     "GRANTOR_CONTACT",
  //     "GRANTOR_CONTACT_PHONE",
  //     "GRANTOR_CONTACT_EMAIL",
  //     "ESTIMATED_POST_DATE",
  //     "ESTIMATED_APPLICATION_DUE_DATE",
  //     "POSTED_DATE",
  //     "CLOSE_DATE",
  //     "OPPORTUNITY_STATUS",
  //     "FUNDING_DESCRIPTION",
  //     "ELIGIBLE_APPLICANTS"
  // }
  //       },
  //     - UserData {
  //         "_id",
  //         "companyName",
  //         "companyOverview",
  //         "yearOfEstablishment",
  //         "employeeCount",
  //         "services",
  //         "industry",
  //         "location",
  //         "website",
  //         "linkedIn",
  //         "certifications",
  //         "awards",
  //         "clientPortfolio",
  //         "pastProjects",
  //         "caseStudies",
  //         "preferredIndustries",
  //         "pointOfContact",
  // }
  // grant_result = {
  // "cover_letter",
  // "executive_summary",
  // "introduction",
  // "problem_statement",
  // "goals_objectives",
  // "project_description",
  // "timeline",
  // "evaluation_plan",
  // "personnel",
  // "budget_narrative",
  // "sustainability_plan",
  // "appendices"
  //     }

  // Define text to update by element ID
  const idTextMap = {
    //pag1
    "sfb0qxhzo": userData.companyName,
    "buo0cwdou": grantData["OPPORTUNITY_TITLE"],
    "s85d0tldh": getFormattedDate(),
    "ey860fgut": userData.location + "\n" + userData.website,
    //page2

    //page3
    "mdub9ouyg": grantData["OPPORTUNITY_TITLE"],
    "amqnhn7r5": userData.companyName,
    "e393dkga7": getFormattedDate(),
    "4ey4knfhs": grant_result.cover_letter,

    //page4
    "mpkoy5vrc": grantData["OPPORTUNITY_TITLE"],
    "tlvgf6hp8": userData.companyName,
    "3g8qoyfmb": getFormattedDate(),
    "mets36xr9": grant_result.executive_summary,

    //page5
    "sb4xu4at9": grantData['OPPORTUNITY_TITLE'],
    "j01snnxfv": userData.companyName,
    "tuss33u6f": getFormattedDate(),
    "4eyndmkib": grant_result.introduction,

    //page6
    "mxzpxxnjo": grantData["OPPORTUNITY_TITLE"],
    "1z73ijy8k": userData.companyName,
    "juifg3w23": getFormattedDate(),
    "zjlwgdt8i": grant_result.problem_statement,

    //page7
    "qdqptcvc3": grantData["OPPORTUNITY_TITLE"],
    "e6fvde4op": userData.companyName,
    "s3ni6ilv0": getFormattedDate(),
    "lbs3kajag": grant_result.goals_objectives,

    //page8
    "dcb17250f": grantData["OPPORTUNITY_TITLE"],
    "x2yby8dgv": userData.companyName,
    "27xoznepe": getFormattedDate(),
    "av3rcuxl4": grant_result.project_description,

    //page9
    "vnjr21s7m": grantData["OPPORTUNITY_TITLE"],
    "kxp07qj8i": userData.companyName,
    "o6gdqq202": getFormattedDate(),
    "88d3f1l3a": grant_result.timeline,

    //page10
    "tg2kneo4b": grantData["OPPORTUNITY_TITLE"],
    "kqvsb9pql": userData.companyName,
    "4zdegwrsx": getFormattedDate(),
    "gc7hokh4z": grant_result.evaluation_plan,

    //page11
    "7dazzlr2d": grantData["OPPORTUNITY_TITLE"],
    "nn7ertnve": userData.companyName,
    "udlmeex0z": getFormattedDate(),
    "m14li90xw": grant_result.personnel,

    //page12
    "a6mnqs3pi": grantData["OPPORTUNITY_TITLE"],
    "vcygupow0": userData.companyName,
    "wbdun45xt": getFormattedDate(),
    "ru4uuq3pc": grant_result.budget_narrative,

    //page13
    "bbz72200c": grantData["OPPORTUNITY_TITLE"],
    "n995jqud7": userData.companyName,
    "l40zfj9n3": getFormattedDate(),
    "osz6i3jcc": grant_result.sustainability_plan,

    //page14
    "gm8bbqjgr": grantData["OPPORTUNITY_TITLE"],
    "1a2awvl8b": userData.companyName,
    "zaliz1uya": getFormattedDate(),
    "etw86yng5": grant_result.appendices,
  };

  // Function to replace text by ID
  function legacy_replaceTextById(data, idTextMap) {
    data.pages?.forEach((page) => {
      page.elements?.forEach((element) => {
        if (element.type === "text" && element.id && idTextMap[element.id]) {
          element.properties = element.properties || {};
          element.properties.text = idTextMap[element.id]; // replace text
        }
      });
    });
    return data;
  }
  // Function to replace text by ID with safety checks 
  function replaceTextById(data, idTextMap) {
    if (!data || typeof data !== 'object') {
      console.warn('replaceTextById: Invalid data parameter');
      return data;
    }

    if (!idTextMap || typeof idTextMap !== 'object') {
      console.warn('replaceTextById: Invalid idTextMap parameter');
      return data;
    }
    data.pages?.forEach((page, pageIndex) => {
      // Check if page is valid
      if (!page || typeof page !== 'object') {
        console.warn(`replaceTextById: Invalid page at index ${pageIndex}`);
        return;
      }
      page.elements?.forEach((element, elementIndex) => {
        // Comprehensive element validation
        if (!element || typeof element !== 'object') {
          console.warn(`replaceTextById: Invalid element at page ${pageIndex}, element ${elementIndex}`);
          return;
        }

        // Check if element is text type and has valid ID
        if (element.type === "text" && element.id && idTextMap.hasOwnProperty(element.id)) {
          try {
            // Ensure properties object exists
            element.properties = element.properties || {};

            // Get the replacement text
            const replacementText = idTextMap[element.id];

            // Validate replacement text and handle different cases
            if (replacementText === null || replacementText === undefined) {
              element.properties.text = "Text not found";
              console.warn(`replaceTextById: Replacement text for ID ${element.id} is null/undefined, showing warning message`);
            } else if (replacementText === "") {
              element.properties.text = "Empty text";
              console.warn(`replaceTextById: Replacement text for ID ${element.id} is empty, showing warning message`);
            } else {
              // Convert to string to ensure it's always a string
              element.properties.text = String(replacementText);
            }


          } catch (error) {
            console.error(`replaceTextById: Error processing element with ID ${element.id}:`, error);
            // Set user-friendly error message
            element.properties = element.properties || {};
            element.properties.text = "Loading error";
          }
        }
      });
    });
    return data;
  }

  // Apply replacements
  const updatedJson = replaceTextById(jsonData, idTextMap);

  // Return the processed data instead of writing to file
  return updatedJson;
}


module.exports = { replaceTextInJson_Grant };
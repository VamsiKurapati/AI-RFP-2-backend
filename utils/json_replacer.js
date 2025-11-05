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
 * @param {string} outputFile  Path to output JSON file
 * @param {Object} proposalData  Data source for replacements
 * @param {Object} userData      Data source for replacements
 */

function replaceTextInJson(inputFile, proposalData, userData, rfpData) {
  // Load JSON
  const jsonData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  // string builders
  let employee_String = userData.employees_information
    .slice(0, 5)
    .map(emp => {
      const topSkills = emp.skills.slice(0, 3).join(", ");
      return `${emp.name}\t${emp.jobTitle}\t${topSkills}`;
    }).join("\n");

  let cert_Name_String = userData.certifications
    .map(cert => cert.name)
    .join("\n");

  let cert_issued_String = userData.certifications
    .map(cert => cert.issuer)
    .join("\n");

  let cert_issued_date_String = userData.certifications
    .map(cert => cert.validTill)
    .join("\n");

  const awards_firstHalf = userData.awards.slice(0, 3).join("\n");
  const awards_secondHalf = userData.awards.length > 3 ? userData.awards.slice(3).join("\n") : "";

  let projectsString = userData.pastProjects.map(p => p.name).join("\n");
  let caseStudiesString = userData.caseStudies.map(c => c.Title).join("\n");

  // Define text to update by element ID
  const idTextMap = {
    //pag1
    "sfb0qxhzo": userData.companyName,
    "buo0cwdou": rfpData["RFP Title"],
    "s85d0tldh": getFormattedDate(),
    "ey860fgut": userData.location + "\n" + userData.website,
    //page2

    //page3
    "mdub9ouyg": rfpData["RFP Title"],
    "amqnhn7r5": userData.companyName,
    "e393dkga7": getFormattedDate(),
    "4ey4knfhs": proposalData.summary,
    //page4
    "sb4xu4at9": rfpData["RFP Title"],
    "j01snnxfv": userData.companyName,
    "tuss33u6f": getFormattedDate(),
    "4eyndmkib": proposalData.objectives,

    //page5
    "mxzpxxnjo": rfpData['RFP Title'],
    "1z73ijy8k": userData.companyName,
    "juifg3w23": getFormattedDate(),
    "zjlwgdt8i": proposalData.proposed_solution,

    //page6
    "dcb17250f": rfpData["RFP Title"],
    "x2yby8dgv": userData.companyName,
    "27xoznepe": getFormattedDate(),
    "av3rcuxl4": proposalData.deliverables,

    //page7
    "oylv4651k": rfpData["RFP Title"],
    "sml8c7n57": userData.companyName,
    "k27rh2pci": getFormattedDate(),
    "py7u859qk": proposalData.project_plan_tech_stack,

    //page8
    "vnjr21s7m": rfpData["RFP Title"],
    "kxp07qj8i": userData.companyName,
    "o6gdqq202": getFormattedDate(),
    "88d3f1l3a": proposalData.timeline,

    //page9
    "tg2kneo4b": rfpData["RFP Title"],
    "kqvsb9pql": userData.companyName,
    "4zdegwrsx": getFormattedDate(),
    "gc7hokh4z": proposalData.risk_assessment,

    //page10
    "a6mnqs3pi": rfpData["RFP Title"],
    "vcygupow0": userData.companyName,
    "wbdun45xt": getFormattedDate(),
    "ru4uuq3pc": proposalData.budget_estimate,

    //page11
    "7dazzlr2d": rfpData["RFP Title"],
    "nn7ertnve": userData.companyName,
    "udlmeex0z": getFormattedDate(),
    "m14li90xw": proposalData.team_details,

    //page12
    "m19j8subn": rfpData["RFP Title"],
    "mucg3l24k": userData.companyName,
    "0bjhx1p07": getFormattedDate(),
    "v78no4hjq": proposalData.certifications_awards,
    "35e192y6x": cert_Name_String,
    "b5bayno80": cert_issued_date_String,
    "pyx59by62": cert_issued_String,
    "pv7rgfqzh": awards_firstHalf + "\n" + awards_secondHalf,

    //page13
    "79r01186b": rfpData["RFP Title"],
    "0272zwvof": userData.companyName,
    "s74ju2ssi": getFormattedDate(),
    "0u9y51lyn": proposalData.caseStudies,

    //page14
    "zy6zq47zd": rfpData["RFP Title"],
    "86ohbs6cd": userData.companyName,
    "7jlxt1p8r": getFormattedDate(),
    "oknuxrpj2": proposalData.pastProjects,

    //page15
    "f9smebw4k": rfpData["RFP Title"],
    "cm1fihph1": userData.companyName,
    "09rapdyr2": getFormattedDate(),
    "joc0g7s91": proposalData.Partnership_Overview,

    //page16
    "f9smebw4k": rfpData["RFP Title"],
    "cm1fihph1": userData.companyName,
    "09rapdyr2": getFormattedDate(),
    "joc0g7s91": proposalData.references_proven_results,

    //page17
    "gm8bbqjgr": rfpData["RFP Title"],
    "1a2awvl8b": userData.companyName,
    "zaliz1uya": getFormattedDate(),
    "etw86yng5": proposalData.why_us,

    //page18
    "ctrxb9v51": rfpData["RFP Title"],
    "td31ssthl": userData.companyName,
    "0xidw6oi3": getFormattedDate(),
    "rhtfsgrfk": proposalData.terms_conditions,

    //page19
    "2uzagqz7f": rfpData["RFP Title"],
    "y5kmwem4e": userData.companyName,
    "4fq2v9ilp": getFormattedDate(),
    "ryr2k6yjj": proposalData.cover_letter,
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

module.exports = { replaceTextInJson };

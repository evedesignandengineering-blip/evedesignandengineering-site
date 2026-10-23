# EVE BYDA Helper for MicroStation CONNECT Edition

A free starter workflow for preparing a Before You Dig Australia (BYDA) request from a MicroStation drawing. This starter does **not** submit a request automatically: the user reviews the site in BYDA and presses Submit in the official portal.

## Current starter scope

- MicroStation CONNECT Edition VBA macro source.
- Uses a user-selected closed shape as the intended work-area boundary.
- Records drawing/model name, date, job reference, MGA94 (EPSG:283xx must be chosen for the correct zone), and boundary coordinates in a CSV preparation file.
- Opens the official BYDA website for manual review and submission.
- Includes a local request log file workflow; do not treat a prepared request as submitted.

## Important MGA94 note

“MGA94” is not a complete coordinate reference system by itself. The correct MGA zone (MGA94 / Zone 50–56, EPSG:28350–28356) depends on the work site's longitude. Confirm the drawing's zone before using coordinates. This starter does not automatically convert MGA eastings/northings to latitude/longitude and does not assume a zone.

## Requirements

- Windows PC with MicroStation CONNECT Edition installed.
- MicroStation VBA support enabled in the installed product.
- A drawing whose coordinate system and units have been checked.
- A BYDA user account. The standard BYDA referral service is free.
- No BYDA API key or API subscription for this manual starter workflow.

## Install (source workflow)

1. Download `EVE_BYDA_Starter.bas` from this folder.
2. In MicroStation CONNECT Edition, open the VBA manager (key-in: `vba` / use Utilities > Macro > Project Manager, depending on workspace).
3. Create a new VBA project in a trusted local folder, then import the `.bas` module.
4. Save the VBA project as `EVE_BYDA_Starter.mvba`.
5. Run macro `EVE_BYDA_Starter.PrepareBYDARequest`.
6. Follow the prompts and choose a closed Shape element as the site boundary. The macro writes a CSV preparation file and opens BYDA.
7. Review the location and boundary in BYDA, complete all required fields, and submit there. Record the BYDA enquiry/reference only after the portal confirms submission.

Menu labels vary by MicroStation workspace and configuration. If VBA is disabled by your organisation, ask the CAD administrator to enable an approved macro path.

## Safety and limitations

- This helper does not access private BYDA endpoints, bypass login, or submit a request invisibly.
- It does not verify that a selected shape is geographically correct or that MGA94 zone/units are correct.
- The generated CSV is a preparation/audit record, not an official BYDA submission.
- Check BYDA responses and all asset-owner plans before excavation. A BYDA enquiry does not itself authorise excavation.
- The source is a starter and should be tested on a copy of a drawing before production use.

## Official links

- BYDA free enquiry service: https://www.byda.com.au/
- BYDA free service guide: https://help.byda.com.au/
- BYDA API information (subscription-based): https://help.byda.com.au/article/api-integration/
- Bentley MicroStation developer resources: https://www.bentley.com/support/software-developers/

## Next development stage

To make a production-grade in-product dockable panel, reliable CRS conversion, request history, and tested drawing-selection support, compile a managed add-in against the matching MicroStation CONNECT SDK and test it in the user's exact MicroStation version/workspace. Automated lodgement requires BYDA API access and approved credentials.

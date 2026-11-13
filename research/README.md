# AskPay research and prototype status

`askpay-bibliography.bib` preserves the bibliography supplied for the project. Its entries and URLs have not been independently verified; inclusion is not evidence that a method is implemented or that a paper supports a particular claim.

The existing Python service is a keyword-based demonstration, not a LegalIR/LegalQA model. Its seven sample records lack authoritative provenance and current clause-level legal status. They cannot establish the accuracy of legal advice or authorize real settlement. The validator compares text only against those samples; passing it does not verify that an answer follows from a citation or that a law is in force. The TypeScript route also contains a separate mock fallback. Do not use this prototype for real funds or legal decisions.

Before production, ingest authoritative source text and versioned effective dates for the required corpus, independently review each clause and amendment, integrate and evaluate the retrieval and QA components, reconcile the two validators, and validate the escrow and oracle workflow end to end. The requested 30-document corpus and models were not supplied.

Run the API with `python -m uvicorn main:app --app-dir ai-service` after installing `ai-service/requirements.txt`. Run contract tests with `python -m unittest discover -s ai-service/tests -v`. The standalone validator accepts `POST /api/v1/legal/validate` with a JSON object containing a `citations` array. The corpus endpoint marks the current data `DEMO_UNVERIFIED`.

// The text an organisation agrees to the first time anyone from it signs in.
//
// A FIRST VERSION, NOT THE FINAL POLICY. It states the commitments Ben specified for the
// quote tool, in plain words, adapted to what this engine actually touches — and nothing
// beyond them. No invented retention carve-outs, no borrowed boilerplate about
// jurisdictions or sub-processors nobody has decided on. An empty promise is worse than a
// short one.
//
// THE ONE THING SAID HERE THAT IS NOT SAID IN THE QUOTE TOOL'S COPY is that this tool
// reads a mailbox and writes bookings into OnSinch. Somebody agreeing on their company's
// behalf should not have to infer that from the product name.
//
// WHEN THE REAL POLICY LANDS, bump TERMS_VERSION in orgProfile.ts. The acceptance table
// is keyed on that version, so every organisation is asked again rather than being
// treated as having agreed to text they never saw.

export interface TermsSection {
  heading: string;
  body: string[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: "Who provides this tool",
    body: [
      "The Spartan Crew booking engine is created and maintained by SamurAI Solutions. It is licensed to your organisation for the use of your team. Our website and our published privacy policy are at samuraisolutions.co.uk.",
    ],
  },
  {
    heading: "What it reads and what it writes",
    body: [
      "The engine reads the enquiries arriving in your bookings mailbox, and from them drafts crew orders in OnSinch and replies for a person to check. It holds the enquiry, the client, the venue, the dates and the crew numbers because those are the booking.",
      "Nothing is sent to a client without a person deciding to send it.",
    ],
  },
  {
    heading: "We do not share your data with third parties",
    body: [
      "We do not sell, rent, trade or otherwise disclose your data to any third party. Not to advertisers, not to data brokers, not to other clients. There is no exception to this that we have quietly written down somewhere else.",
    ],
  },
  {
    heading: "What your data is used for",
    body: [
      "Your data is used only to run this tool for you, and in the research and development of your own deployment — making it better at the specific work your team does.",
      "It is not used to train anything for anybody else, and it is not pooled with another client's data.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "We retain data for 90 days. After that it is removed on a rolling basis.",
    ],
  },
  {
    heading: "Who can get in",
    body: [
      "Access is limited to approved email domains and addresses agreed with your organisation. Signing in is what grants access, under those rules.",
    ],
  },
];

/** Plain-text rendering, for anywhere that cannot show the structured version. */
export function termsPlainText(): string {
  return TERMS_SECTIONS.map((s) => `${s.heading}\n\n${s.body.join("\n\n")}`).join("\n\n");
}

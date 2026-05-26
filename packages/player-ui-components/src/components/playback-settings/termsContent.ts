/**
 * EZPlayer Terms of Use — starter drafts. NOT lawyer-reviewed; review before
 * relying on this text in production. Edit freely; no other consumers besides
 * the LegalFooter Terms dialog.
 *
 * Two surfaces, rendered as tabs by the Terms dialog:
 *   - `TERMS_SPIRIT_TEXT` — plain-English summary highlighting what we
 *     actually care about. The user's first stop.
 *   - `TERMS_LETTER_TEXT` — formal "blah-blah" Terms document.
 *
 * Known drift: TERMS_LETTER_TEXT does not yet include explicit Privacy,
 * audit-cooperation, or Right-to-be-Forgotten sections that the Spirit
 * promises. Update the Letter to match before publishing.
 */

export const TERMS_SPIRIT_TEXT = `DRAFT — review before publishing.

Most of the "Letter" tab is the same blah-blah you've read on every other website. Here's what we actually care about.

What these terms cover.

Two different things wear the EZPlayer name:
  - The home player. The desktop app you install on your own machine. Open source, AGPL-3.0. It runs on its own and does not talk to us unless you connect it. The AGPL is the primary license; it includes its own no-warranty disclaimer.
  - The cloud service. EZRGB-hosted features — your account, layout processing, sequence rendering, scheduling, viewer pages, the music-rights system. These terms primarily govern this.

Most of what's below (rights cooperation, transparency, privacy, deletion) only matters when you're using the cloud service.

Copyright is real.

EZRGB respects all rights holders. A few specifics:
  - Before you can download an audio file, music ownership must be confirmed. We're giving your own file back to you, not handing you a copy of someone else's.
  - If you bring your own sequence (BYOS) to our platform, you're swearing you're allowed to use it.
  - If a rights holder or their agent submits an audit request, we will provide the information they need — for audit purposes only.
  - If a rights holder asserts that their works are never licensed under terms that permit use of this platform, we will make a legitimate effort to remove or block those works.

Transparency.

If a removal, block, or audit request touches your account, you will hear about it from us, clearly. We do not play head games.

Privacy.

  - We are allowed to use your data for product improvement. This is not optional.
  - We are allowed to use your data for audit and compliance. This is not optional.
  - We are only allowed to use your data for marketing if you opt in.

Right to be forgotten.

We will delete your account and data when you ask us to. Your effect on the system may persist, though — a layout that informed a fix, schedules that shaped a feature. We scrub records. We cannot scrub ripples.

Don't break us on purpose.

Probing, attacking, abusing, or otherwise messing with the Service — or using the Service to mess with anyone else — is grounds for getting kicked out. The Letter tab spells out the specifics.

No warranty.

The Letter tab spells this out at length. Short version: software has bugs, services have outages, this one is no exception, and by using us you accept that risk. The AGPL also disclaims warranty for the home player; we are calling it out here for both.`;

export const TERMS_LETTER_TEXT = `DRAFT — review before publishing.

1. Acceptance

By creating an account, signing in, or using any part of the EZPlayer service ("the Service"), you agree to these Terms of Use. If you do not agree, do not use the Service.

2. The Service

These Terms apply to two distinct components:

(a) EZRGB Cloud Service ("the Cloud Service") — Cloud-hosted features including account management, layout processing, sequence rendering, scheduling, the viewer portal, the music-rights tracking system, and any related Web interfaces operated by EZRGB. Use of the Cloud Service is governed by these Terms in full.

(b) EZPlayer Application ("the Application") — The desktop application distributed in source form by the EZPlayer Contributors under the GNU Affero General Public License, version 3 (AGPL-3.0-only). The AGPL is the primary license governing your use, modification, and redistribution of the Application. These Terms govern the Application only to the extent it interacts with the Cloud Service.

Sections 5, 8, and 9 (Music & Copyright; Privacy; Account Deletion) apply to use of the Cloud Service. Sections 11 and 12 (Warranty Disclaimer; Limitation of Liability) apply to both, in addition to and without limiting the AGPL's own warranty disclaimer for the Application.

Specific features of the Cloud Service are offered subject to your account tier and may change.

3. Your Account

You are responsible for keeping your sign-in credentials secret and for all activity under your account. Notify us promptly if you believe your account has been accessed by someone else. You must be 18 or older, or have permission from a parent or guardian, to use the Service.

4. Your Content

You retain ownership of layouts, sequences, audio, images, schedules, and other materials you upload ("Your Content"). You grant EZRGB a limited, worldwide, royalty-free license to host, process, transmit, render, and display Your Content solely to operate the Service for you and to make the parts you choose to publish (such as a viewer page) available to the audience you designate.

You are responsible for Your Content, including the right to upload and use it.

5. Music and Copyright

You may only upload, process, or play music for which you hold the rights, or which is otherwise legally cleared for your use. The Service includes a rights tracking feature that records ownership claims you submit; the feature is provided to support your record-keeping and does not constitute legal advice or a license to use any work.

You agree not to use the Service to publicly perform, distribute, or otherwise exploit copyrighted music without the necessary licenses from rights holders or applicable performance-rights organizations.

If a rights holder or their authorized agent submits an audit request concerning your account, EZRGB may disclose information sufficient to satisfy that request, and only for that purpose. You will be informed when such a request touches your account, except where prohibited by law or by valid legal process.

If a rights holder asserts that its works are never licensed under terms that permit use on this Service, EZRGB will make a legitimate effort to remove or block the identified works from your use of the Service.

6. Acceptable Use

You agree not to:
  - Use the Service for any unlawful purpose;
  - Upload malware or attempt to disrupt, probe, or reverse-engineer the Service;
  - Attempt to access another user's account, data, or shows;
  - Use the Service to publish content that is unlawful, harassing, hateful, or infringing;
  - Impose unreasonable load on the Service or interfere with others' use.

7. Viewer Pages

If you enable a public viewer page, the content you choose to publish (show name, description, schedule, song list, location, etc.) becomes accessible to anyone with the page URL. You are responsible for the content you choose to publish.

8. Privacy and Use of Your Data

EZRGB collects and processes data about you and your use of the Service. By using the Service you acknowledge and agree that:
  - EZRGB may use your data to operate, secure, and improve the Service. This use is not optional.
  - EZRGB may use your data to respond to audit, compliance, and legal requests as described in Section 5. This use is not optional.
  - EZRGB will only use your data for marketing communications if you have opted in to receive them, and you may withdraw that consent at any time.

9. Account Deletion ("Right to be Forgotten")

You may request deletion of your account and associated personal data at any time. On a valid request EZRGB will, within a reasonable period, delete or anonymize your account record, your show settings, your uploaded content, and other personal data EZRGB holds about you, subject to:
  - Data EZRGB is required to retain by law or by valid legal process;
  - Aggregated or de-identified data that no longer identifies you;
  - Effects of your prior use on the Service that cannot be unwound.

10. Service Availability

The Service is provided on an "as-is" and "as-available" basis. EZRGB does not guarantee uninterrupted operation, freedom from errors, or that specific data will be retained. Scheduled and unscheduled downtime, data loss, or feature changes may occur.

11. Disclaimer of Warranties

To the fullest extent permitted by law, the Service is provided without warranty of any kind, whether express, implied, or statutory, including without limitation warranties of merchantability, fitness for a particular purpose, and non-infringement.

12. Limitation of Liability

To the fullest extent permitted by law, in no event will EZRGB or its operators be liable for any indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost data, or business interruption, arising out of or in connection with your use of the Service. Aggregate liability is limited to the amount you have paid for the Service in the twelve months preceding the event giving rise to the claim, or USD 50, whichever is greater.

13. Termination

You may stop using the Service at any time. EZRGB may suspend or terminate your access if you breach these Terms, if required by law, or if continued operation of your account materially harms the Service or other users. EZRGB will make reasonable efforts to give you notice and an opportunity to retrieve Your Content where practical.

14. Changes

EZRGB may revise these Terms from time to time. Material changes will be brought to your attention before they take effect. Continued use of the Service after revised Terms take effect constitutes acceptance of the revisions.

15. Governing Law

These Terms are governed by the laws of the Commonwealth of Pennsylvania, United States, without regard to its conflict-of-laws rules. Disputes arising under these Terms will be resolved in the courts of that jurisdiction.

16. Contact

Questions about these Terms can be sent to ezplayer@ezrgb.com.`;


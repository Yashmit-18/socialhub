/**
 * Text of SocialHub's public legal pages (/privacy.html, /terms.html, /data-deletion.html).
 *
 * Every statement here describes what the code actually does (as audited on 2026-11-24).
 * When behaviour changes (publishing goes live, insights are enabled, account self-deletion
 * ships, a new service provider is added), update the matching section AND `LAST_UPDATED`.
 * Do not add claims of certifications or legal compliance that have not been verified.
 *
 * Inline syntax and block types: see legalHtml.js.
 */
import { legalLink } from './legalLinks.js';

/**
 * ---------------------------------------------------------------------------------------
 * OPERATOR AND CONTACT: the one place to change who runs SocialHub and how to reach them.
 * Shown on all three pages. `operator` is the name people see as responsible for the data.
 * ---------------------------------------------------------------------------------------
 */
export const LEGAL_CONTACT = {
  // The person responsible for the data. When a business is registered for Meta Business
  // Verification, use exactly the legal name on its certificate here.
  operator: 'Yashmit Jeminy (SocialHub)',
  email: 'workwithyashmit@gmail.com',
};

export const LAST_UPDATED = '25 November 2026';

const privacy = legalLink('privacy');
const terms = legalLink('terms');
const deletion = legalLink('data-deletion');

export const PRIVACY_POLICY = {
  ...privacy,
  description:
    'How SocialHub collects, uses, protects, shares and deletes personal data, including data received from Facebook and Instagram.',
  intro: [
    'This policy explains what personal data SocialHub collects, why, how it is protected, who it is shared with and how you can have it deleted. SocialHub is a team workspace for managing Facebook Pages and Instagram professional accounts. It is operated by {{operator}}, and you can reach us at {{email}}.',
    {
      note: 'SocialHub is in active development. A post is sent to Facebook or Instagram only in a workspace whose owner or admin has turned on real publishing, and only after a member confirms that post; otherwise publishing runs in a simulated mode that sends nothing to Meta. Reading detailed insights (analytics) from Meta is not enabled. This policy describes SocialHub as it works today; it will be updated before that changes.',
    },
  ],
  sections: [
    {
      id: 'information-you-give-us',
      heading: 'Information you give us',
      blocks: [
        {
          list: [
            '**Account details:** your name, email address and password. Your password is never stored as you typed it; SocialHub keeps only a one-way bcrypt hash.',
            '**Workspace content:** workspace names; invitations (the invited person’s email address); members’ roles and account access; post drafts, including captions, hashtags, first comments and image descriptions; media files you upload; labels and notes you add to accounts; and Facebook Group directory entries and sharing tasks your team creates.',
          ],
        },
      ],
    },
    {
      id: 'information-from-meta',
      heading: 'Information we receive from Facebook and Instagram',
      blocks: [
        'Only a workspace owner or admin can connect Facebook or Instagram. They sign in through Meta’s official login dialog, so SocialHub never sees their Facebook or Instagram password. With the permissions they grant, SocialHub receives:',
        {
          list: [
            '**Through Facebook Login:** your Facebook user ID, name and profile picture; the list of permissions you granted or declined; and, for each Facebook Page you manage, its ID, name, category, picture, the tasks you can perform on it and a Page access token, together with the Instagram professional account linked to the Page, if any (its ID, username, name and profile picture).',
            '**Through Instagram Login, where it is enabled:** your Instagram account ID, username, name, account type and profile picture.',
            '**Access tokens** that let SocialHub act on these accounts within the permissions you granted.',
            '**Follower counts** of connected Pages and Instagram accounts, refreshed when the connection is checked.',
          ],
        },
        'Through Facebook Login SocialHub requests `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`. Only when Instagram publishing is switched on does it also request `instagram_basic` and `instagram_content_publish` through Facebook Login, or `instagram_business_basic` and `instagram_business_content_publish` through Instagram Login. Meta’s dialog shows exactly what is requested, and you can decline permissions there.',
      ],
    },
    {
      id: 'information-collected-automatically',
      heading: 'Information collected automatically',
      blocks: [
        {
          list: [
            '**Sign-in sessions:** the IP address and browser (user agent) a session was started from and when it was last used, so that your account can be protected. Session records are deleted automatically when the session expires.',
            '**Activity log:** important actions in a workspace, such as connecting or removing an account or changing a member’s role, are recorded with who did them and when. The IP address and browser used are stored with each entry for security investigations; they are not shown in the app.',
            '**Server logs:** each request’s method, address and result. Sign-in codes, access tokens, cookies and invitation links are removed from these logs.',
          ],
        },
        'SocialHub contains no advertising, analytics or other tracking scripts.',
      ],
    },
    {
      id: 'cookies',
      heading: 'Cookies and browser storage',
      blocks: [
        'SocialHub uses only the cookies and browser storage it needs to work:',
        {
          table: {
            head: ['Name', 'Purpose', 'How long'],
            rows: [
              [
                '`sh_rt` (cookie)',
                'Keeps you signed in. It is HttpOnly, so page scripts cannot read it, and it is only sent to SocialHub’s sign-in endpoints.',
                '30 days, or until you sign out',
              ],
              [
                '`sh_oauth_…` (cookie)',
                'Confirms that a Facebook or Instagram connection is completed in the same browser that started it.',
                '10 minutes',
              ],
              [
                '`sh-theme` (browser storage)',
                'Your light or dark theme choice.',
                'Until you change it or clear your browser data',
              ],
              [
                '`sh-last-workspace` (browser storage)',
                'Opens the workspace you used last.',
                'Until you clear your browser data',
              ],
              [
                'Composer drafts and presets (browser storage)',
                'Keeps unsaved post drafts and your composer presets on this device.',
                'Drafts are removed when you sign out',
              ],
            ],
          },
        },
      ],
    },
    {
      id: 'how-we-use-information',
      heading: 'How we use information',
      blocks: [
        {
          list: [
            'To create your account, sign you in and keep your account secure.',
            'To show the Facebook Pages and Instagram accounts a workspace has connected to its members, according to the access each member is given.',
            'To check that each connection still works and to keep account names, pictures and follower counts up to date.',
            'To prepare posts and, when a workspace member chooses to publish and confirms it, to send that content (its text and media files) to the Page or Instagram account they selected. In a workspace that has not turned on real publishing, publishing is simulated and sends nothing to Meta.',
            'To send emails you ask for: team invitations and password reset links.',
            'To investigate security problems and misuse.',
          ],
        },
        'Data received from Meta is used only to provide these features to the workspace that connected it. We do not sell personal data, we do not use it for advertising, and we do not use data from Meta to build profiles of people.',
      ],
    },
    {
      id: 'how-we-protect-information',
      heading: 'How we protect information',
      blocks: [
        {
          list: [
            'Facebook and Instagram access tokens are encrypted at rest with AES-256-GCM, using a key kept in the server’s configuration rather than in the database. Tokens are never sent to your browser and are kept out of logs.',
            'Passwords are stored as bcrypt hashes. Sign-in sessions, password reset links, invitation links and the security codes used while connecting to Meta are stored only as SHA-256 hashes.',
            'Every connection to Facebook or Instagram uses a single-use security code that expires after 10 minutes and must be completed in the browser that started it.',
            'Meta’s deauthorize and data deletion notifications are accepted only when their signature, made with SocialHub’s app secret, is valid.',
            'SocialHub is served over HTTPS, and its sign-in cookies are marked Secure and HttpOnly.',
            'Within a workspace, access is based on roles: only owners and admins can connect, disconnect or remove Facebook and Instagram logins.',
          ],
        },
        'No system is completely secure, and we cannot guarantee that data will never be accessed without permission.',
      ],
    },
    {
      id: 'who-we-share-information-with',
      heading: 'Who we share information with',
      blocks: [
        'We do not sell or rent personal data. It is shared only as needed to run SocialHub:',
        {
          list: [
            '**Meta Platforms:** sign-in, token and account requests go to Facebook and Instagram when you connect or check an account, and a post’s text and media files go to them when a member publishes it for real.',
            '**Members of your workspace:** the people in a workspace see its connected accounts, drafts and activity according to their role.',
            '**Service providers that run SocialHub for us:** MongoDB Atlas, which hosts SocialHub’s database; Cloudflare, which carries traffic between your browser and SocialHub; and, when email delivery is turned on, an email delivery provider. They process data only to provide their service.',
            '**When the law requires it:** we may disclose information if we are legally required to.',
          ],
        },
        'Media files you upload are stored by SocialHub and are served only through signed links that expire. Links shown inside SocialHub work for a few hours. When a post is published for real, Meta receives a link that works for about two hours, long enough to download the file; after that the published post is public on Facebook or Instagram.',
      ],
    },
    {
      id: 'how-long-we-keep-information',
      heading: 'How long we keep information',
      blocks: [
        {
          list: [
            '**Account details:** until your SocialHub account is deleted.',
            '**Facebook and Instagram data and tokens:** until a workspace owner or admin removes the connection, the workspace is deleted, or Meta tells SocialHub that you asked for your data to be deleted. Disconnecting, or removing SocialHub in your Facebook settings, erases the tokens straight away but keeps account names and pictures so the team can reconnect; removing the connection deletes them.',
            '**Sign-in sessions:** deleted automatically when they expire. Security codes used while connecting to Meta: deleted about an hour after they expire. Connection check history: 90 days.',
            '**Workspace content** (drafts, media files, activity log, publishing history, Facebook Group directory): until it is deleted in the app or the workspace is deleted.',
            '**Records of Meta data deletion requests:** the confirmation code, the date, how many items were deleted and a one-way hash of the Meta user ID, kept so that the status of the request can be checked. They do not contain your name or other details.',
          ],
        },
      ],
    },
    {
      id: 'your-choices-and-rights',
      heading: 'Your choices and rights',
      blocks: [
        {
          list: [
            `**Disconnect or remove** Facebook and Instagram connections at any time. [${deletion.title}](${deletion.path}) explains every option and what each one deletes.`,
            '**Remove SocialHub in your Facebook or Instagram settings.** Meta then notifies SocialHub, which erases the access tokens. If you also ask Meta to delete your data, SocialHub deletes your connections and the accounts obtained through them.',
            '**Change your name and password** on your Account page. To change the email address of your account, contact us.',
            '**Delete a workspace:** its owner can delete it, with everything in it, under Settings.',
            '**Delete your SocialHub account:** SocialHub does not have a self-service option for this yet. Email {{email}} from your account’s email address and ask for it to be deleted.',
            '**Access or correct your data:** contact us at {{email}}.',
          ],
        },
        'Depending on where you live, data protection law may give you further rights. To exercise any of them, contact us at {{email}}.',
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      blocks: [
        'SocialHub is a tool for managing business and creator accounts. It is not directed at children.',
      ],
    },
    {
      id: 'changes-to-this-policy',
      heading: 'Changes to this policy',
      blocks: [
        'When our practices change, we will update this page and the “Last updated” date at the top.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [
        'For questions or requests about this policy or your data, email {{operator}} at {{email}}.',
      ],
    },
  ],
};

export const TERMS_OF_SERVICE = {
  ...terms,
  description:
    'The terms for using SocialHub, the team workspace for Facebook Pages and Instagram professional accounts.',
  intro: [
    `These terms apply to your use of SocialHub, which is operated by {{operator}}. By creating an account or using SocialHub you agree to them. Our [${privacy.title}](${privacy.path}) explains how we handle personal data.`,
  ],
  sections: [
    {
      id: 'the-service',
      heading: 'The service',
      blocks: [
        'SocialHub lets teams connect Facebook Pages and Instagram professional accounts through Meta’s official login, see the health of each connection, control which team members can use which accounts, prepare posts and organise sharing to Facebook Groups.',
        {
          note: 'SocialHub is in active development. Posts are sent to Facebook or Instagram only in workspaces where an owner or admin has turned on real publishing, and only after a member confirms each post; elsewhere publishing runs in a simulated mode. Features may change, be added or be removed.',
        },
      ],
    },
    {
      id: 'your-account',
      heading: 'Your account',
      blocks: [
        {
          list: [
            'Give accurate information when you create your account, and keep your password secure.',
            'You are responsible for activity in your account. Tell us at {{email}} if you think someone has used it without your permission.',
          ],
        },
      ],
    },
    {
      id: 'workspaces-and-teams',
      heading: 'Workspaces and teams',
      blocks: [
        'The person who creates a workspace is its owner. Owners and admins decide who joins the workspace, what role each member has and which connected accounts each member can use. Owners are responsible for the people they invite and the access they give them.',
      ],
    },
    {
      id: 'connecting-facebook-and-instagram',
      heading: 'Connecting Facebook and Instagram',
      blocks: [
        {
          list: [
            'Connect only Facebook Pages and Instagram accounts that you are authorised to manage.',
            'Your use of Facebook and Instagram through SocialHub must also follow Meta’s own terms and policies, including the Facebook Terms of Service and the Instagram Terms of Use.',
            'SocialHub can only do what the permissions you grant in Meta’s login dialog allow. You can withdraw them at any time in SocialHub or in your Facebook or Instagram settings.',
          ],
        },
      ],
    },
    {
      id: 'acceptable-use',
      heading: 'Acceptable use',
      blocks: [
        'Do not use SocialHub to:',
        {
          list: [
            'publish or share content that is unlawful, infringes someone else’s rights, or breaks Meta’s Community Standards;',
            'send spam or run misleading or automated activity that breaks Meta’s rules;',
            'access accounts, workspaces or data you are not authorised to access;',
            'interfere with SocialHub’s security, probe it for weaknesses, or overload it.',
          ],
        },
      ],
    },
    {
      id: 'your-content',
      heading: 'Your content',
      blocks: [
        'You keep ownership of the content you add to SocialHub, such as drafts, media and notes. You allow SocialHub to store and process it only to provide the service to your workspace, including sending it to Facebook or Instagram when a member of your workspace chooses to publish it.',
      ],
    },
    {
      id: 'availability',
      heading: 'Availability and changes',
      blocks: [
        'We work to keep SocialHub available and correct, but we cannot promise that it will always be available, uninterrupted or free of errors. SocialHub depends on Meta’s services, which can change or limit access at any time. We may change these terms; when we do, we will update this page and the “Last updated” date at the top.',
      ],
    },
    {
      id: 'ending-your-use',
      heading: 'Suspension and ending your use',
      blocks: [
        `You can stop using SocialHub at any time. [${deletion.title}](${deletion.path}) explains how to delete your connections, workspaces and account. We may suspend or close accounts that break these terms or put other people, their data or SocialHub at risk.`,
      ],
    },
    {
      id: 'disclaimer',
      heading: 'Disclaimer and liability',
      blocks: [
        'SocialHub is provided “as is”. To the extent the law allows, we do not give warranties about it and are not liable for indirect or consequential losses, or for losses caused by Meta’s services or by content that members of your workspace publish. Nothing in these terms limits rights that you have under the law and that cannot be limited.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: ['Questions about these terms: email {{operator}} at {{email}}.'],
    },
  ],
};

export const DATA_DELETION_INSTRUCTIONS = {
  ...deletion,
  description:
    'How to delete the data SocialHub holds about you, including data received from Facebook and Instagram, and what each option deletes.',
  intro: [
    'You can delete the data SocialHub holds about your Facebook or Instagram account at any time, either inside SocialHub or from your Facebook or Instagram settings. This page explains each option and exactly what it deletes.',
  ],
  sections: [
    {
      id: 'remove-in-socialhub',
      heading: 'Option 1: Remove the connection in SocialHub',
      blocks: [
        'Workspace owners and admins can do this:',
        {
          steps: [
            'Sign in to SocialHub and open the workspace.',
            'Go to **Accounts**, then the **Logins** tab.',
            'Open the menu next to the Facebook or Instagram login and choose **Remove with its accounts**.',
            'Confirm with **Remove login and accounts**.',
          ],
        },
        'This permanently deletes the login and its encrypted access token, and the Facebook Pages and Instagram accounts obtained through it, together with their tokens, insights and connection check history. They are also removed from every member’s access list. For a Facebook login that no other SocialHub workspace uses, SocialHub also asks Meta to withdraw the permissions you granted.',
        {
          note: '**Disconnect** is not the same as remove: it erases the access tokens straight away but keeps the account names and pictures, so the team can reconnect later. Choose **Remove with its accounts** to delete them.',
        },
      ],
    },
    {
      id: 'remove-in-facebook',
      heading: 'Option 2: Remove SocialHub in your Facebook settings',
      blocks: [
        {
          steps: [
            'In Facebook, open **Settings & privacy**, then **Settings**.',
            'Open **Apps and websites**. Apps connected through Facebook Login for Business may be listed under **Business integrations** instead.',
            'Select SocialHub and choose **Remove**.',
            'If Facebook offers to send the app a request to delete your data, send it.',
          ],
        },
        'Removing the app makes Meta notify SocialHub, and SocialHub immediately marks your Facebook login as revoked and erases its access tokens in every workspace. If you also send a deletion request, SocialHub deletes your Facebook logins and the Pages and Instagram accounts obtained through them in every workspace, and Meta shows you a confirmation code. Meta may change the names of these menus.',
      ],
    },
    {
      id: 'remove-in-instagram',
      heading: 'Option 3: Remove SocialHub in your Instagram settings',
      blocks: [
        'If you connected an Instagram account through Instagram Login, open Instagram’s settings, find **Website permissions** and then **Apps and websites**, and remove SocialHub. Meta notifies SocialHub in the same way as for Facebook, and SocialHub erases the tokens, or deletes the connection and its accounts if you ask for your data to be deleted.',
      ],
    },
    {
      id: 'check-status',
      heading: 'Check the status of a deletion request',
      blocks: [
        'When Meta sends SocialHub a deletion request for you, it gives you a confirmation code and a status link. The link opens `/api/v1/meta/data-deletion/` followed by your code on this website and shows the confirmation code, the status of the request and when it was completed.',
      ],
    },
    {
      id: 'delete-workspace-or-account',
      heading: 'Delete a workspace or your SocialHub account',
      blocks: [
        {
          list: [
            '**Workspace:** the workspace owner can open **Settings** and choose **Delete** under **Delete workspace**, then type the workspace name and their password. This permanently deletes the workspace and everything in it: members’ access, invitations, drafts, media files, activity log, connections, accounts, publishing history and analytics. Facebook logins that no other workspace uses are also withdrawn at Meta.',
            '**Your SocialHub account:** SocialHub does not have a self-service option for this yet. Email {{email}} from your account’s email address and ask for your account to be deleted.',
          ],
        },
      ],
    },
    {
      id: 'what-is-deleted',
      heading: 'What is deleted and what is kept',
      blocks: [
        {
          table: {
            head: ['Option', 'Deleted', 'Kept'],
            rows: [
              [
                'Disconnect (SocialHub), or removing the app in Facebook or Instagram settings',
                'Access tokens',
                'Account names, pictures and follower counts, so the team can reconnect',
              ],
              [
                'Remove with its accounts (SocialHub), or a deletion request through Meta',
                'The login, its accounts, their tokens, names, pictures, follower counts, labels, notes, insights and connection check history',
                'Workspace activity log entries and publishing history that mention the account by name, until the workspace is deleted. A record of a Meta deletion request (see below).',
              ],
              [
                'Delete workspace',
                'Everything in the workspace',
                'Your SocialHub user account, until you ask for it to be deleted',
              ],
            ],
          },
        },
        'For requests that come through Meta, SocialHub keeps a small record so that the status link keeps working: the confirmation code, the date, how many items were deleted and a one-way hash of your Meta user ID. It contains no names or other details.',
      ],
    },
    {
      id: 'contact',
      heading: 'Need help?',
      blocks: [
        'If you cannot use any of these options, email {{email}} with the name of the Facebook Page or Instagram account, and we will delete the data for you.',
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS = [PRIVACY_POLICY, TERMS_OF_SERVICE, DATA_DELETION_INSTRUCTIONS];

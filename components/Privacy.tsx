import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const EFFECTIVE_DATE = 'September 23, 2026';
const POLICY_URL = 'https://www.garbagin.com/privacy';

const linkClass =
  'text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200';

const Privacy: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    const prevLang = document.documentElement.lang;
    const prevDir = document.documentElement.dir;
    document.title = 'GarbaGin Privacy Policy';
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    return () => {
      document.title = prevTitle;
      document.documentElement.lang = prevLang;
      document.documentElement.dir = prevDir;
    };
  }, []);

  return (
    <div className="scrollable-sheet-content h-full w-full overflow-x-hidden bg-slate-950 text-white">
      <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-400/80">
              GURGINI LLC
            </p>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">GarbaGin Privacy Policy</h1>
            <p className="mt-2 text-sm text-slate-400">
              Effective {EFFECTIVE_DATE}. Public URL:{' '}
              <a className={linkClass} href={POLICY_URL}>
                {POLICY_URL}
              </a>
            </p>
          </div>
          <Link
            to="/"
            className="shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300 hover:bg-cyan-500/20 transition-all"
          >
            Back to App
          </Link>
        </header>

        <main className="space-y-8 rounded-3xl border border-white/10 bg-slate-900/60 p-6 sm:p-8 text-slate-300 leading-relaxed">
          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">1. Who we are</h2>
            <p>
              This policy explains how <strong className="text-white">GURGINI LLC</strong>, a limited
              liability company organized in New Mexico, United States (“GURGINI,” “we,” “us”), handles
              personal information when you use <strong className="text-white">GarbaGin</strong> (also
              shown in the product as Garbagin), the Clean Egypt cleaning and garbage-removal
              marketplace. The Service includes the website and progressive web app at garbagin.com
              (including www.garbagin.com), in-app features, and related server functions.
            </p>
            <p className="mt-3">
              GarbaGin connects people who post cleaning or garbage-removal missions with independent
              workers. Standard jobs are negotiated and paid directly between users. Some garbage-removal
              missions use community crowdfunding processed by Stripe. Platform actions such as placing a
              bid use an in-app token balance.
            </p>
            <p className="mt-3">
              This page does not require an account. The same text is available at{' '}
              <Link className={linkClass} to="/privacy">
                /privacy
              </Link>{' '}
              and{' '}
              <Link className={linkClass} to="/privacy-policy">
                /privacy-policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">2. Information we collect</h2>
            <p className="mb-4">
              We collect only what the Service needs to run the marketplace, keep users safe, and process
              payments you start. We do not run a third-party advertising network, and we do not use a
              product-analytics SDK such as Google Analytics.
            </p>

            <h3 className="mb-2 text-base font-bold text-white">Account and sign-in (Supabase)</h3>
            <p>
              Accounts are provided by Supabase Auth. Depending on how you sign in, we process:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Email address and a password (the password is stored by Supabase as a hash).</li>
              <li>A one-time email sign-in link, if you request one.</li>
              <li>
                Google account email (and name, if Google shares it), if you choose Google sign-in. We
                do not receive your Google password.
              </li>
              <li>
                Telegram user id, display name, and username, if you open GarbaGin inside Telegram. We
                create or sign in to an account linked to that Telegram id. Telegram’s own policy applies
                to the Telegram app.
              </li>
              <li>Session tokens stored in your browser so you stay signed in.</li>
            </ul>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Profile and contact details</h3>
            <p>If you add them, we store:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Name, profile photo, contact email, phone number, and Telegram username.</li>
              <li>Token balance, subscription status, and verification status.</li>
            </ul>
            <p className="mt-3">
              Phone numbers (including the number used for WhatsApp) and other creator contact details
              stay hidden on mission cards and public profiles. A worker can see them only after the
              mission creator accepts that worker’s bid, or when that worker is assigned to the mission.
            </p>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Identity checks</h3>
            <p>
              Workers may be asked to verify identity before some jobs. That can include photos of an
              identity document, a short liveness video from your camera, and the device location at the
              time of capture if you allow location. These files are stored for moderation. Platform
              admins can review them. They are not shown on your public profile.
            </p>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Missions, photos, and chat</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Mission content you submit: title, description, service type, price or funding goal,
                status, and map coordinates.
              </li>
              <li>
                Photos and videos you upload (before/after proof, chat images, store gallery, avatar).
                Media is stored in Cloudflare R2. Older files may still be in Supabase Storage.
              </li>
              <li>Bids, reviews, and in-app chat messages between mission participants.</li>
            </ul>
            <p className="mt-3">
              Mission pins and photos you publish are visible to other users of the marketplace. Chat is
              limited to the mission creator, bidders, and the assigned worker.
            </p>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Location and the map (Mapbox)</h3>
            <p>Location is used to show and navigate missions, not to build an advertising profile.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="text-white">Precise location</span>, if you grant permission: to center
                the map, drop a mission pin, check proof location, run the optional augmented-reality
                view, and attach coordinates to a liveness check.
              </li>
              <li>
                Coordinates you type or pick on the map, and the place name returned by Mapbox
                geocoding.
              </li>
              <li>
                The map area you are viewing. Mapbox receives map requests (including approximate
                viewport and technical data such as IP address) under Mapbox’s terms so tiles can load.
              </li>
            </ul>
            <p className="mt-3">
              You can refuse or later revoke location permission in the browser or device settings. The
              map still works for places you choose manually. Mission coordinates you publish remain
              visible on that mission.
            </p>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Live air and sea traffic</h3>
            <p>
              The map can show public aircraft and ships near the area on screen. To do that, our server
              sends the map bounding box (not your account id) to:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>OpenSky Network (flight states),</li>
              <li>public ADS-B aircraft feeds, and</li>
              <li>AISStream (ship positions).</li>
            </ul>
            <p className="mt-3">
              Those feeds describe aircraft and vessels, not you. We do not attach that traffic to your
              profile. The map center may also be sent to Open-Meteo to draw local weather. Open-Meteo
              does not receive your account.
            </p>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Payments (Stripe)</h3>
            <p>
              Stripe processes card payments for token packs, worker subscriptions, and crowdfunding
              contributions. Stripe receives the payment details you enter in Stripe’s form, along with
              the amount, currency, and a reference to your user id and (for a contribution) the mission.
              We store the result: amount, status, Stripe identifiers, and the token or funding credit.
            </p>
            <p className="mt-3">
              We do not store your full card number or card security code. Stripe’s privacy policy
              applies to card data it collects.
            </p>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Push notifications (Firebase)</h3>
            <p>
              If you allow notifications, we register a Firebase Cloud Messaging token or a Web Push
              subscription and store it with your user id. We use it to send mission and account alerts.
              You can turn notifications off in the browser or operating system. We delete tokens that
              stop working, and we delete them when you delete your account.
            </p>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Automated checks (OpenAI)</h3>
            <p>We use OpenAI on our server for limited safety and product features:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Screening mission photos for unsafe content before they are published.</li>
              <li>
                Reviewing mission text and images for fraud signals, including attempts to hide contact
                details in a listing.
              </li>
              <li>Translating mission text when you ask to see it in another language.</li>
            </ul>
            <p className="mt-3">
              The content needed for that check (text and, when relevant, the image) is sent to OpenAI.
              We do not send your password or payment card. OpenAI processes that content under its API
              terms.
            </p>

            <h3 className="mb-2 mt-5 text-base font-bold text-white">Device and on-device storage</h3>
            <p>The app stores small items in your browser, such as:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>The sign-in session.</li>
              <li>Language, map display choices, and similar settings.</li>
              <li>A short-lived flag so we can confirm a Stripe return.</li>
            </ul>
            <p className="mt-3">
              We do not use those values for cross-site advertising. Hosting, fonts, and the map, payment,
              and Telegram scripts may receive your IP address and standard browser data when the page
              loads.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">3. How we use information</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Create and secure your account, and keep you signed in.</li>
              <li>Show missions on the map and in the market feed, and match bids to jobs.</li>
              <li>Unlock contact details only after a bid is accepted, as described above.</li>
              <li>Process token purchases, subscriptions, and crowdfunding contributions.</li>
              <li>Send push and in-app notices about missions you are part of.</li>
              <li>Moderate content, investigate disputes, and reduce fraud and abuse.</li>
              <li>Translate listings on request and show map, weather, and live-traffic context.</li>
              <li>Keep financial and audit records, and comply with law.</li>
              <li>Respond to support requests.</li>
            </ul>
            <p className="mt-3">
              Operators can review operational records (missions, payments, reports) in an admin console
              for moderation and support. That console is not a public analytics product, and it is not
              sold as audience data.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">4. When we share information</h2>
            <p>We share personal information with processors that perform services for us:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="text-white">Supabase</span> — authentication, database, realtime, and
                some file storage.
              </li>
              <li>
                <span className="text-white">Cloudflare R2</span> — photos, video, verification files,
                and other media.
              </li>
              <li>
                <span className="text-white">Mapbox</span> — maps and reverse geocoding.
              </li>
              <li>
                <span className="text-white">Stripe</span> — card payments.
              </li>
              <li>
                <span className="text-white">Google Firebase</span> — push delivery to your device.
              </li>
              <li>
                <span className="text-white">OpenAI</span> — the safety, fraud, and translation checks
                in section 2.
              </li>
              <li>
                <span className="text-white">OpenSky, ADS-B feeds, and AISStream</span> — public traffic
                for the map viewport.
              </li>
              <li>
                <span className="text-white">Open-Meteo</span> — weather at the map center.
              </li>
              <li>
                <span className="text-white">Google</span> — if you use Google sign-in.
              </li>
              <li>
                <span className="text-white">Telegram</span> — if you use the Telegram mini app, or if
                we send an operational notice through Telegram.
              </li>
              <li>
                <span className="text-white">Vercel</span> — hosting for the app and server functions.
              </li>
            </ul>
            <p className="mt-3">We also share information in these cases:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="text-white">Other users</span>, as needed for a mission: public name,
                avatar, listing text, photos, map location, bids, reviews, and chat. Phone and Telegram
                contact stay locked until bid acceptance, as described above.
              </li>
              <li>
                <span className="text-white">Municipal authorities</span>, when a crowdfunding cleanup
                expires without reaching its goal. We may generate a PDF and send a notice that includes
                the mission location, coordinates, description, and funding totals. That notice is a
                request for public-works review. It does not include your payment card.
              </li>
              <li>
                <span className="text-white">Legal and safety</span> — if we must disclose information
                to comply with law, enforce our terms, or protect users and the public.
              </li>
              <li>
                <span className="text-white">Business transfer</span> — if GURGINI is involved in a
                merger or sale, information may transfer with the Service, still subject to this policy.
              </li>
            </ul>
            <p className="mt-3">
              We do not sell personal information. We do not share it for cross-context behavioral
              advertising.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">5. Retention</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Account, profile, and sign-in data are kept while your account is open.</li>
              <li>
                Chat, push tokens, bids, reviews tied to you, your contractor store, and verification
                files are deleted when your account is deleted.
              </li>
              <li>
                Mission records you created or worked may stay on the map with your name and account id
                removed, so a public cleanup pin is not erased with your profile.
              </li>
              <li>
                Crowdfunding pins that expire after partial funding can remain in a public history for
                about seven days. After that window, the listing leaves the public feed and mission
                photos may be deleted. An audit row (coordinates, amounts, city-notice log) can remain.
              </li>
              <li>
                Payment and token ledger rows are kept in anonymized form after deletion (your user id
                is removed) for accounting, tax, fraud prevention, and disputes.
              </li>
              <li>
                Server logs are kept for a limited time needed to operate and secure the Service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">6. Security</h2>
            <p>
              We use HTTPS, database access rules that limit who can read each row, and Stripe for card
              data. Verification files are not public. Contact details stay hidden until a bid is
              accepted. No method of transmission or storage is perfectly secure. Please use a unique
              password and protect access to your email and device.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">7. Children</h2>
            <p>
              GarbaGin is not directed to children under 13, and we do not knowingly collect personal
              information from children under 13. The Service involves real-world tasks, location, and
              payments, and it is meant for people who can use those features lawfully where they live.
            </p>
            <p className="mt-3">
              If you believe a child under 13 has given us personal information, email us and we will
              delete it. If we learn we have collected it, we will delete the account and the associated
              personal information.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">8. Your choices and rights</h2>
            <p>You can:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Review and update your name, phone, Telegram username, and avatar in your profile.</li>
              <li>Turn off location and notifications in the browser or device settings.</li>
              <li>Stop using Google or Telegram sign-in and use email instead, or stop using the Service.</li>
              <li>Request a copy of the personal information we hold, or ask us to correct it.</li>
              <li>Delete your account, as described in section 9.</li>
            </ul>
            <p className="mt-3">
              Depending on where you live, including the European Economic Area, the United Kingdom, and
              certain U.S. states, you may have rights to access, correct, delete, or receive a copy of
              your personal information, and to object to or restrict certain processing. We do not sell
              personal information or share it for cross-context behavioral advertising. To use a right,
              email us from the address on the account. We may need to confirm it is you. We aim to
              reply within 30 days.
            </p>
            <p className="mt-3">
              You may lodge a complaint with a data protection authority. We ask that you contact us
              first so we can try to resolve it.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">9. Account deletion</h2>
            <p>You can delete your account in the app:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Sign in and open your profile.</li>
              <li>Choose <span className="text-white">Delete Account</span>.</li>
              <li>
                Type <span className="text-white">DELETE</span> (or <span className="text-white">УДАЛИТЬ</span>)
                and confirm.
              </li>
            </ol>
            <p className="mt-3">
              Finish or cancel active missions first. Deletion removes your sign-in, profile, chats,
              push tokens, and personal files, including verification media. Financial ledger rows stay
              without your user id. Mission pins may remain without your identity, as described in
              section 5.
            </p>
            <p className="mt-3">
              You can also email{' '}
              <a className={linkClass} href="mailto:support@cleanegypt.co">
                support@cleanegypt.co
              </a>{' '}
              or{' '}
              <a className={linkClass} href="mailto:sgurzheyev@gmail.com">
                sgurzheyev@gmail.com
              </a>{' '}
              from the account email with the subject “Account deletion request.” The in-app support
              address{' '}
              <a className={linkClass} href="mailto:support@garbagin.com">
                support@garbagin.com
              </a>{' '}
              reaches the same operator.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">10. International transfers</h2>
            <p>
              GURGINI LLC is in New Mexico, United States. Supabase, Stripe, Cloudflare, Google,
              Mapbox, OpenAI, Vercel, and the traffic and weather providers may process information in
              the United States and in other countries where they operate. Those countries may have
              data-protection rules that differ from the rules in your country. We use these providers
              to run the Service you request.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">11. Changes to this policy</h2>
            <p>
              We will post updates on this page and change the effective date above. Please review
              this page from time to time. The current version is always at {POLICY_URL}.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-cyan-300">12. Contact</h2>
            <p>
              Privacy questions, access requests, and deletion requests:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Email:{' '}
                <a className={linkClass} href="mailto:support@cleanegypt.co">
                  support@cleanegypt.co
                </a>
              </li>
              <li>
                Email:{' '}
                <a className={linkClass} href="mailto:sgurzheyev@gmail.com">
                  sgurzheyev@gmail.com
                </a>
              </li>
              <li>
                In-app support:{' '}
                <a className={linkClass} href="mailto:support@garbagin.com">
                  support@garbagin.com
                </a>
              </li>
            </ul>
            <p className="mt-3">
              Operator: GURGINI LLC, New Mexico, United States. Product: GarbaGin / Clean Egypt
              marketplace.
            </p>
            <p className="mt-4 text-sm text-slate-400">
              Related:{' '}
              <Link className={linkClass} to="/terms">
                Terms of Service
              </Link>
              .
            </p>
          </section>
        </main>
      </div>
    </div>
  );
};

export default Privacy;

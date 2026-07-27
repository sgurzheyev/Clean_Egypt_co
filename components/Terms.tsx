import React from 'react';
import { Link } from 'react-router-dom';

const Terms: React.FC = () => {
  return (
    <div className="min-h-screen w-full bg-slate-950 text-white">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Garbagin Terms of Service</h1>
          <Link
            to="/"
            className="shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300 hover:bg-cyan-500/20 transition-all"
          >
            Back to App
          </Link>
        </header>

        <main className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/60 p-6 sm:p-8">
          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">1. Platform Purpose</h2>
            <p className="text-slate-300 leading-relaxed">
              Garbagin is a marketplace that connects clients and workers for cleaning missions worldwide.
              By using the platform, you agree to follow these terms and all applicable laws.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">2. Accounts and Eligibility</h2>
            <p className="text-slate-300 leading-relaxed">
              You are responsible for your account credentials and activity. You must provide accurate
              profile information and use the platform only for legitimate mission-related purposes.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">3. Tokens, Subscriptions &amp; P2P Pay</h2>
            <p className="text-slate-300 leading-relaxed">
              Garbagin uses a SaaS token economy. Tokens are spent on platform actions such as
              boosting pins and crowdfunding stakes. Worker lead access is gated by an optional
              yearly subscription. Payment for completed cleaning work is negotiated and settled
              directly between client and worker (P2P) — the platform does not hold fiat escrow,
              deposits, or revenue-share payouts. Token packs and subscriptions are digital
              services and are generally non-refundable except where required by law.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">4. Mission Conduct</h2>
            <p className="text-slate-300 leading-relaxed">
              Users must not post illegal, abusive, or misleading mission content. Workers must submit
              truthful before/after evidence. Fraud, manipulation, and policy violations can result in
              mission cancellation or account suspension.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-cyan-300">5. Liability and Changes</h2>
            <p className="text-slate-300 leading-relaxed">
              Garbagin provides the service on an as-available basis. We may update features, fees,
              or policies over time. Continued use after updates means you accept the revised terms.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
};

export default Terms;

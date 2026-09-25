// Help — "How Mission Control works" plus a glossary of the words colleagues
// meet on screen (Wave 6 — colleague UX). Copy lives in help-content.ts.
import { GLOSSARY, HOW_IT_WORKS } from "./help-content";

export function HelpView() {
  return (
    <div className="mc-main" data-testid="help-screen">
      <div className="ph">
        <div>
          <span className="kk">Help</span>
          <h1>
            How Mission Control <em>works</em>
          </h1>
          <p className="sub">A short tour, and the words you&apos;ll see around the app.</p>
        </div>
      </div>

      <div className="help">
        <section aria-labelledby="help-how">
          <h2 id="help-how">How Mission Control works</h2>
          <ol className="help-steps">
            {HOW_IT_WORKS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="help-glossary">
          <h2 id="help-glossary">Glossary</h2>
          <dl className="help-glossary">
            {GLOSSARY.map((entry) => (
              <div key={entry.term}>
                <dt>{entry.term}</dt>
                <dd>
                  {entry.definition}
                  {entry.list ? (
                    <ol className="help-stages">
                      {entry.list.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

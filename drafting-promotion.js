/* EVE Design & Engineering — temporary drafting promotion.
   To hide this promotion everywhere, change PROMOTION_ENABLED to false.
   To remove it permanently, remove this file and its script tag from the public HTML pages. */
(function () {
  const PROMOTION_ENABLED = true;
  if (!PROMOTION_ENABLED || document.getElementById("eve-drafting-promotion")) return;

  const style = document.createElement("style");
  style.textContent = `
    .eve-promo{display:flex;align-items:center;justify-content:space-between;gap:22px;width:100%;padding:17px 5.6%;background:linear-gradient(110deg,#edf5fb,#f7fafc);border-bottom:1px solid #dce7f0;color:#102947;box-sizing:border-box}
    .eve-promo *{box-sizing:border-box}
    .eve-promo-copy{min-width:0}
    .eve-promo-kicker{display:block;margin:0 0 3px;color:#28658f;font:800 9px/1.4 "DM Sans",Arial,sans-serif;letter-spacing:.13em;text-transform:uppercase}
    .eve-promo-title{margin:0 0 3px;color:#09284b;font:800 clamp(17px,2vw,22px)/1.25 Manrope,"DM Sans",Arial,sans-serif;letter-spacing:-.025em}
    .eve-promo-desc{margin:0;color:#526579;font:12px/1.5 "DM Sans",Arial,sans-serif}
    .eve-promo-desc strong{color:#123e63}
    .eve-promo-cta{display:inline-flex;align-items:center;justify-content:center;gap:8px;flex-shrink:0;padding:10px 14px;border-radius:7px;background:#123e63;color:#fff!important;text-decoration:none!important;font:800 11px/1.4 "DM Sans",Arial,sans-serif;white-space:nowrap}
    .eve-promo-cta:hover{background:#1b5b86}
    @media(max-width:640px){.eve-promo{align-items:flex-start;flex-direction:column;gap:10px;padding:16px 6%}.eve-promo-cta{white-space:normal}}
  `;
  document.head.appendChild(style);

  const promo = document.createElement("aside");
  promo.id = "eve-drafting-promotion";
  promo.className = "eve-promo";
  promo.setAttribute("aria-label", "Drafting promotion");
  promo.innerHTML = '<div class="eve-promo-copy"><span class="eve-promo-kicker">Limited-time offer · Electrical drafting</span><h2 class="eve-promo-title">Professional Drafting From $50/Hour</h2><p class="eve-promo-desc">Turn sketches and redline markups into professional drawings. <strong>$50/hour</strong> drafting support, plus <strong>one free trial drafting task</strong>.</p></div><a class="eve-promo-cta" href="/#contact">Discuss Your Drafting Needs <span aria-hidden="true">→</span></a>';

  const header = document.querySelector("header.nav") || document.querySelector("header");
  if (header) header.insertAdjacentElement("afterend", promo);
  else document.body.insertBefore(promo, document.body.firstChild);
})();
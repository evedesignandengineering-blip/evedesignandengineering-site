const contactForm = document.getElementById("contactForm");

if (contactForm) {
  contactForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const data = new FormData(this);
    const submitButton = this.querySelector('button[type="submit"], input[type="submit"]');
    const originalButtonText = submitButton ? (submitButton.textContent || submitButton.value || "Send") : "Send";

    const payload = {
      name: data.get("name") || "",
      email: data.get("email") || "",
      phone: data.get("phone") || "Not provided",
      message: data.get("message") || "",
      _subject: "New website enquiry — EVE Design & Engineering",
      _replyto: data.get("email") || "",
      _template: "table",
      _url: window.location.href
    };

    if (submitButton) {
      submitButton.disabled = true;
      if ("value" in submitButton && submitButton.tagName === "INPUT") {
        submitButton.value = "Sending...";
      } else {
        submitButton.textContent = "Sending...";
      }
    }

    try {
      const response = await fetch("https://formsubmit.co/ajax/admin@evedesignandengineering.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Unable to send your enquiry.");
      }

      this.reset();

      const successMessage = document.createElement("div");
      successMessage.className = "form-success";
      successMessage.setAttribute("role", "status");
      successMessage.innerHTML = `
        <div class="form-success-icon" aria-hidden="true">✓</div>
        <div>
          <p class="form-success-eyebrow">Enquiry received</p>
          <h3>Thank you for contacting us.</h3>
          <p>We’ve received your enquiry and appreciate you taking the time to get in touch. Our team will review your message and contact you shortly.</p>
          <p class="form-success-closing">We look forward to discussing your project with you.</p>
        </div>
      `;

      this.replaceWith(successMessage);
    } catch (error) {
      console.error("Contact form submission failed:", error);
      window.alert("We couldn't send your enquiry right now. Please email admin@evedesignandengineering.com directly.");
      if (submitButton) {
        submitButton.disabled = false;
        if ("value" in submitButton && submitButton.tagName === "INPUT") {
          submitButton.value = originalButtonText;
        } else {
          submitButton.textContent = originalButtonText || "Send";
        }
      }
    }
  });
}

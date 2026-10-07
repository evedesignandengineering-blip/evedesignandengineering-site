const contactForm = document.getElementById("contactForm");

if (contactForm) {
  contactForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const data = new FormData(this);
    const submitButton = this.querySelector('button[type="submit"], input[type="submit"]');
    const originalButtonText = submitButton ? submitButton.textContent : "";

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
      submitButton.textContent = "Sending...";
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
      window.alert("Thank you. Your enquiry has been sent to EVE Design & Engineering.");
    } catch (error) {
      console.error("Contact form submission failed:", error);
      window.alert("We couldn't send your enquiry right now. Please email admin@evedesignandengineering.com directly.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText || "Send";
      }
    }
  });
}

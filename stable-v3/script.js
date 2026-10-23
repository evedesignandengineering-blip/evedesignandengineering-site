const contactForm = document.getElementById("contactForm");

if (contactForm) {
  contactForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const form = this;
    const data = new FormData(form);
    const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
    const originalButtonText = submitButton ? (submitButton.textContent || submitButton.value || "Send") : "Send";
    const successPanel = document.querySelector(".contact-success-preview");

    const payload = {
      name: data.get("name") || "",
      email: data.get("email") || "",
      phone: data.get("phone") || "Not provided",
      message: data.get("message") || "",
      _subject: "New website enquiry — EVE Design & Engineering",
      _cc: "admin@evedesignandengineering.com",
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
      const response = await fetch("https://formsubmit.co/ajax/evedesignandengineering@gmail.com", {
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

      form.reset();

      if (successPanel) {
        form.style.display = "none";
        successPanel.classList.add("show");

        window.setTimeout(() => {
          successPanel.classList.remove("show");
          form.style.display = "";
          if (submitButton) {
            submitButton.disabled = false;
            if ("value" in submitButton && submitButton.tagName === "INPUT") {
              submitButton.value = originalButtonText;
            } else {
              submitButton.textContent = originalButtonText || "Send";
            }
          }
        }, 2000);
      } else if (submitButton) {
        submitButton.disabled = false;
        if ("value" in submitButton && submitButton.tagName === "INPUT") {
          submitButton.value = originalButtonText;
        } else {
          submitButton.textContent = originalButtonText || "Send";
        }
      }
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

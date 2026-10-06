document.getElementById("contactForm").addEventListener("submit", function(e){
  e.preventDefault();
  const data = new FormData(this);
  const subject = encodeURIComponent("Project inquiry — EVEDesign & Engineering");
  const body = encodeURIComponent(
`Name: ${data.get("name")}
Email: ${data.get("email")}
Phone: ${data.get("phone") || "Not provided"}

Project details:
${data.get("message")}`
  );
  window.location.href = `mailto:evedesignandengineering@gmail.com?subject=${subject}&body=${body}`;
});

// --- Toggle volet Informations ---
const infoLink = document.querySelector('nav a[href="#informations"]');
const infoPanel = document.getElementById('infoPanel');
const infoClose = document.getElementById('infoClose');

function openInfo() {
  infoPanel.classList.add('visible');
  infoPanel.setAttribute('aria-hidden', 'false');
}

function closeInfo() {
  infoPanel.classList.remove('visible');
  infoPanel.setAttribute('aria-hidden', 'true');
}

// Clic sur le lien “Informations”
infoLink.addEventListener('click', e => {
  e.preventDefault();
  // si déjà ouvert, on ferme
  if (infoPanel.classList.contains('visible')) closeInfo();
  else openInfo();
});

// Clic sur la croix de fermeture
infoClose.addEventListener('click', closeInfo);

// Échap pour fermer le volet
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && infoPanel.classList.contains('visible')) {
    closeInfo();
  }
});
const viewer = document.getElementById('viewer');
  viewer.onload = () => {
    const style = viewer.contentDocument.createElement('style');
    style.textContent = `
      body {
        user-select: none;
      }
    `;
    viewer.contentDocument.head.appendChild(style);
  };
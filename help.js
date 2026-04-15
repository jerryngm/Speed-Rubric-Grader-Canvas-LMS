// Tab switching functionality
(function() {
  const tabButtons = document.querySelectorAll('.help-tab-btn');
  const tabContents = document.querySelectorAll('.help-tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');

      // Remove active class from all buttons and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      // Add active class to clicked button and corresponding content
      button.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    });
  });
})();

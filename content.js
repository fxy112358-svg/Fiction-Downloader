// Store CSS selectors for target elements
let targetSelectors = {
  nextBtn: null,
  content: null
};

// Current picking mode: 'nextBtn' or 'content' or null
let pickingMode = null;

/**
 * Highlight element on mouse over when picking mode is active.
 * @param {MouseEvent} e 
 */
function handleMouseOver(e) {
  if (!pickingMode) return;
  e.target.style.outline = '2px solid red';
}

/**
 * Remove highlight when mouse leaves the element.
 * @param {MouseEvent} e 
 */
function handleMouseOut(e) {
  if (!pickingMode) return;
  e.target.style.outline = '';
}

/**
 * Handle click event to lock the target element selector.
 * @param {MouseEvent} e 
 */
function handleClick(e) {
  if (!pickingMode) return;
  e.preventDefault();
  e.stopPropagation();

  const element = e.target;
  element.style.outline = '';

  // Generate simple CSS selector path for the element
  const selector = getSimpleSelector(element);
  targetSelectors[pickingMode] = selector;

  alert(`Successfully selected [${pickingMode === 'nextBtn' ? 'Next Chapter Button' : 'Content Area'}]!\nSelector: ${selector}`);

  // Reset picking mode and remove event listeners
  pickingMode = null;
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('mouseout', handleMouseOut);
  document.removeEventListener('click', handleClick, true);
}

/**
 * Generate a simple CSS selector for a given DOM element.
 * @param {HTMLElement} el 
 * @returns {string} CSS selector string
 */
function getSimpleSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).join('.');
    if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
  }
  return el.tagName.toLowerCase();
}

// Listen for messages from popup script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startPick') {
    pickingMode = request.targetType;
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    document.addEventListener('click', handleClick, true);
    sendResponse({ status: 'picking_started' });
  } 
  else if (request.action === 'startBatch') {
    handleBatchDownload(request.count).then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Keep message channel open for asynchronous response
  }
});

/**
 * Batch download novel chapters by automatically navigating through pages.
 * @param {number} count - Number of chapters to scrape
 * @returns {Promise<object>} Object containing success status and scraped data array
 */
async function handleBatchDownload(count) {
  if (!targetSelectors.content || !targetSelectors.nextBtn) {
    throw new Error("Please specify both 'Next Chapter Button' and 'Content Area' first!");
  }

  let results = [];

  for (let i = 0; i < count; i++) {
    const contentEl = document.querySelector(targetSelectors.content);
    const nextBtnEl = document.querySelector(targetSelectors.nextBtn);

    if (!contentEl) {
      throw new Error(`Chapter ${i + 1}: Content element not found using selector (${targetSelectors.content})`);
    }

    // Extract page title and text content
    const title = document.title;
    const text = contentEl.innerText;
    results.push({ title, text });

    // Stop if it's the last iteration
    if (i === count - 1) break;

    if (!nextBtnEl) {
      throw new Error(`Chapter ${i + 1}: Next chapter button not found using selector (${targetSelectors.nextBtn}). Reached the end or captcha needed.`);
    }

    // Simulate click to navigate to the next chapter
    nextBtnEl.click();

    // Wait 2 seconds for the new page to load
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return { success: true, data: results };
}
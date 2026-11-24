function logStatus(msg) {
  console.log("[Novel Downloader] " + msg);
  const statusBox = document.getElementById('statusBox');
  if (statusBox) {
    statusBox.innerText += "\n" + msg;
    statusBox.scrollTop = statusBox.scrollHeight;
  }
}

function logError(errMsg) {
  console.error("[Novel Downloader Error] " + errMsg);
  const errorBox = document.getElementById('errorBox');
  if (errorBox) {
    if (errorBox.innerText === "None.") {
      errorBox.innerText = errMsg;
    } else {
      errorBox.innerText += "\n" + errMsg;
    }
    errorBox.scrollTop = errorBox.scrollHeight;
  }
}

document.getElementById('selectNextBtn').addEventListener('click', async () => {
  logStatus("Please click the 'Next Chapter' element on the webpage.");
  window.close();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window._novelPickingMode = 'nextBtn';
          alert("Click the 'Next Chapter' button on the page.");
          if (!window._listenersSet) {
            window._listenersSet = true;
            document.addEventListener('click', (e) => {
              if (window._novelPickingMode !== 'nextBtn') return;
              e.preventDefault();
              e.stopPropagation();
              const el = e.target;
              const selector = el.id ? '#' + el.id : el.tagName.toLowerCase();
              window._nextBtnSelector = selector;
              alert("Selected Next Button: " + selector);
              window._novelPickingMode = null;
            }, true);
          }
        }
      });
    }
  } catch (err) {
    logError("Select button error: " + err.message);
  }
});

document.getElementById('startDownloadBtn').addEventListener('click', async () => {
  try {
    const isDownloadAll = document.getElementById('downloadAllCheck')?.checked || false;
    const inputCount = parseInt(document.getElementById('countInput').value) || 1;
    const targetChapterCount = isDownloadAll ? 9999 : inputCount;
    const encoding = document.getElementById('encodingSelect').value;

    logStatus("Initialization started. Target chapters: " + (isDownloadAll ? "ALL" : targetChapterCount));

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      logError("Active tab not found.");
      return;
    }

    let currentUrl = tab.url;
    let visitedUrls = new Set();
    let pagesData = [];
    let nextBtnSelector = null;

    try {
      const selectorRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window._nextBtnSelector || null
      });
      if (selectorRes && selectorRes[0]) {
        nextBtnSelector = selectorRes[0].result;
      }
    } catch (e) {}

    for (let i = 0; i < targetChapterCount; i++) {
      if (visitedUrls.has(currentUrl)) {
        logStatus("Loop detected. Stopping collection.");
        break;
      }
      visitedUrls.add(currentUrl);

      logStatus(`Processing chapter ${i + 1}... URL: ${currentUrl}`);

      let pageTitle = "";
      let cleanedText = "";
      let nextUrl = "";

      if (i === 0) {
        // First chapter from active tab
        const evalRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (sel) => {
            // Helper functions inside page scope
            const trash = document.querySelectorAll('script, style, noscript, svg');
            trash.forEach(el => el.remove());

            const candidates = document.querySelectorAll('div, article, section, main');
            let bestContainer = null;
            let maxLen = 0;

            candidates.forEach(container => {
              const links = container.querySelectorAll('a');
              const textLen = container.innerText.trim().length;
              if (textLen < 100) return;
              const linkLen = Array.from(links).reduce((acc, l) => acc + l.innerText.length, 0);
              if (linkLen / textLen > 0.5) return;
              if (textLen > maxLen) {
                maxLen = textLen;
                bestContainer = container;
              }
            });

            let rawText = bestContainer ? bestContainer.innerText : document.body.innerText;
            let lines = rawText.split('\n');
            let validLines = [];

            for (let line of lines) {
              let trimmed = line.trim();
              if (!trimmed) {
                validLines.push("");
                continue;
              }
              if (trimmed.length <= 2 && !/^[0-9一二三四五六七八九十百]+$/.test(trimmed)) {
                continue;
              }
              if (line.startsWith(' ') || line.startsWith('\u3000')) {
                validLines.push(line);
              } else {
                validLines.push('\u3000\u3000' + trimmed);
              }
            }

            let frequencyMap = {};
            validLines.forEach(l => {
              let t = l.trim();
              if (t.length > 0 && t.length < 15) {
                frequencyMap[t] = (frequencyMap[t] || 0) + 1;
              }
            });

            let finalLines = [];
            let emptyCount = 0;
            for (let l of validLines) {
              let t = l.trim();
              if (t.length > 0 && t.length < 15 && frequencyMap[t] > 3) continue;
              if (l === "") {
                emptyCount++;
                if (emptyCount <= 1) finalLines.push(l);
              } else {
                emptyCount = 0;
                finalLines.push(l);
              }
            }

            // Find next link
            let foundUrl = null;
            if (sel) {
              const customEl = document.querySelector(sel);
              if (customEl && customEl.href) foundUrl = customEl.href;
            }
            if (!foundUrl) {
              const links = document.querySelectorAll('a');
              for (let link of links) {
                const txt = link.innerText.trim();
                const href = link.getAttribute('href');
                if ((txt.includes('下一页') || txt.includes('下一章') || txt.includes('下页') || txt.toLowerCase() === 'next') && href) {
                  try {
                    foundUrl = new URL(href, window.location.href).href;
                    break;
                  } catch (e) {}
                }
              }
            }

            return {
              title: document.title,
              text: finalLines.join('\n'),
              nextUrl: foundUrl
            };
          },
          args: [nextBtnSelector]
        });

        if (!evalRes || !evalRes[0] || !evalRes[0].result) {
          logError("Failed to extract content from active tab.");
          break;
        }

        pageTitle = evalRes[0].result.title;
        cleanedText = evalRes[0].result.text;
        nextUrl = evalRes[0].result.nextUrl;

      } else {
        // Fetch subsequent chapters via background fetch
        const resp = await fetch(currentUrl);
        if (!resp.ok) {
          logError("HTTP error: " + resp.status);
          break;
        }
        const html = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        pageTitle = doc.title;

        // Run cleaning logic on fetched doc
        const trash = doc.querySelectorAll('script, style, noscript, svg');
        trash.forEach(el => el.remove());

        const candidates = doc.querySelectorAll('div, article, section, main');
        let bestContainer = null;
        let maxLen = 0;
        candidates.forEach(container => {
          const links = container.querySelectorAll('a');
          const textLen = container.innerText.trim().length;
          if (textLen < 100) return;
          const linkLen = Array.from(links).reduce((acc, l) => acc + l.innerText.length, 0);
          if (linkLen / textLen > 0.5) return;
          if (textLen > maxLen) {
            maxLen = textLen;
            bestContainer = container;
          }
        });

        let rawText = bestContainer ? bestContainer.innerText : doc.body.innerText;
        let lines = rawText.split('\n');
        let validLines = [];
        for (let line of lines) {
          let trimmed = line.trim();
          if (!trimmed) {
            validLines.push("");
            continue;
          }
          if (trimmed.length <= 2 && !/^[0-9一二三四五六七八九十百]+$/.test(trimmed)) continue;
          if (line.startsWith(' ') || line.startsWith('\u3000')) {
            validLines.push(line);
          } else {
            validLines.push('\u3000\u3000' + trimmed);
          }
        }

        let frequencyMap = {};
        validLines.forEach(l => {
          let t = l.trim();
          if (t.length > 0 && t.length < 15) frequencyMap[t] = (frequencyMap[t] || 0) + 1;
        });

        let finalLines = [];
        let emptyCount = 0;
        for (let l of validLines) {
          let t = l.trim();
          if (t.length > 0 && t.length < 15 && frequencyMap[t] > 3) continue;
          if (l === "") {
            emptyCount++;
            if (emptyCount <= 1) finalLines.push(l);
          } else {
            emptyCount = 0;
            finalLines.push(l);
          }
        }
        cleanedText = finalLines.join('\n');

        // Find next link in fetched doc
        if (nextBtnSelector) {
          const customEl = doc.querySelector(nextBtnSelector);
          if (customEl && customEl.href) nextUrl = customEl.href;
        }
        if (!nextUrl) {
          const links = doc.querySelectorAll('a');
          for (let link of links) {
            const txt = link.innerText.trim();
            const href = link.getAttribute('href');
            if ((txt.includes('下一页') || txt.includes('下一章') || txt.includes('下页') || txt.toLowerCase() === 'next') && href) {
              try {
                nextUrl = new URL(href, currentUrl).href;
                break;
              } catch (e) {}
            }
          }
        }
      }

      pagesData.push({ title: pageTitle, text: cleanedText });
      logStatus(`[Collected Chapter ${i + 1}] ${pageTitle}`);

      if (!nextUrl || nextUrl === currentUrl) {
        logStatus("Reached the end of book (No more next link found).");
        break;
      }

      currentUrl = nextUrl;
      await new Promise(r => setTimeout(r, 300));

    }

    if (pagesData.length > 0) {
      logStatus("All chapters collected. Generating file...");
      let content = "";
      pagesData.forEach((item, index) => {
        content += `=== [Part ${index + 1}] ${item.title} ===\n\n${item.text}\n\n\n`;
      });

      let blob = new Blob([content], { type: "text/plain;charset=" + encoding });
      let url = URL.createObjectURL(blob);
      let filename = "novel_" + Date.now() + ".txt";

      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          logError("Download failed: " + chrome.runtime.lastError.message);
        } else {
          logStatus("File successfully sent to Downloads! ID: " + downloadId);
        }
      });
    } else {
      logStatus("No chapters were collected.");
    }

  } catch (err) {
    logError("Critical Error: " + err.message);
  }
});
const MAX_TEXT_CHARS = 6_000;
const MAX_ELEMENTS = 120;
const MAX_LABEL_CHARS = 80;

const HELPERS = `
  var MAX_ELEMENTS = ${MAX_ELEMENTS};
  var MAX_LABEL_CHARS = ${MAX_LABEL_CHARS};
  var visible = function (element) {
    var rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    var style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
  };
  var label = function (element) {
    var aria = element.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, MAX_LABEL_CHARS);
    var text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, MAX_LABEL_CHARS);
    var value = element.getAttribute('value');
    if (value) return String(value).slice(0, MAX_LABEL_CHARS);
    var placeholder = element.getAttribute('placeholder');
    return placeholder ? placeholder.trim().slice(0, MAX_LABEL_CHARS) : '';
  };
  var unique = function (selector) {
    try { return document.querySelectorAll(selector).length === 1; }
    catch (error) { return false; }
  };
  var cssPath = function (element) {
    var tag = element.tagName.toLowerCase();
    if (element.id) {
      var byId = '#' + CSS.escape(element.id);
      if (unique(byId)) return byId;
    }
    var attrs = ['data-testid', 'data-test-id', 'data-test', 'name', 'aria-label'];
    for (var i = 0; i < attrs.length; i += 1) {
      var value = element.getAttribute(attrs[i]);
      if (!value || String(value).indexOf('"') !== -1) continue;
      var byAttr = tag + '[' + attrs[i] + '="' + String(value) + '"]';
      if (unique(byAttr)) return byAttr;
    }
    var parts = [];
    var node = element;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var part = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) { parts.unshift(part); break; }
      var siblings = Array.prototype.filter.call(parent.children, function (child) { return child.tagName === node.tagName; });
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  };
  var findByText = function (needle) {
    var wanted = String(needle).replace(/\\s+/g, ' ').trim().toLowerCase();
    var nodes = document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="submit"], input[type="button"], summary, label');
    var partial = null;
    for (var i = 0; i < nodes.length; i += 1) {
      if (!visible(nodes[i])) continue;
      var text = label(nodes[i]).toLowerCase();
      if (text === wanted) return nodes[i];
      if (!partial && text.indexOf(wanted) !== -1) partial = nodes[i];
    }
    return partial;
  };
`;

const wrap = (body: string): string => `(() => {\n${HELPERS}\n${body}\n})()`;

export const buildSnapshotScript = ({ selector }: { selector?: string } = {}): string => wrap(`
  var scopeSelector = ${JSON.stringify(selector ?? '')};
  var root = document;
  if (scopeSelector) {
    try { root = document.querySelector(scopeSelector); }
    catch (error) { return { ok: false, error: 'Invalid selector: ' + scopeSelector }; }
    if (!root) return { ok: false, error: 'No element matches ' + scopeSelector };
  }
  var nodes = root.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [contenteditable="true"]');
  var elements = [];
  var visibleTotal = 0;
  for (var i = 0; i < nodes.length; i += 1) {
    var element = nodes[i];
    if (!visible(element)) continue;
    visibleTotal += 1;
    if (elements.length >= MAX_ELEMENTS) continue;
    var rect = element.getBoundingClientRect();
    elements.push({
      selector: cssPath(element),
      tag: element.tagName.toLowerCase(),
      label: label(element),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
      disabled: element.disabled === true
    });
  }
  var body = root === document ? document.body : root;
  var rawText = body ? (body.innerText || body.textContent || '') : '';
  var text = rawText.replace(/\\n{3,}/g, '\\n\\n').trim();
  var maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return {
    ok: true,
    url: String(location.href),
    title: String(document.title || ''),
    scope: scopeSelector || 'document',
    scrollY: Math.round(window.scrollY),
    maxScrollY: Math.round(maxScrollY),
    text: text.slice(0, ${MAX_TEXT_CHARS}),
    textTruncated: text.length > ${MAX_TEXT_CHARS},
    textTotalChars: text.length,
    elements: elements,
    elementsTruncated: visibleTotal > elements.length,
    interactiveElementsOnPage: visibleTotal
  };
`);

export const buildClickScript = ({ selector, text }: { selector?: string; text?: string }): string => wrap(`
  var selector = ${JSON.stringify(selector ?? '')};
  var text = ${JSON.stringify(text ?? '')};
  var target = null;
  if (selector) {
    try { target = document.querySelector(selector); }
    catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
  } else {
    target = findByText(text);
  }
  if (!target) return { ok: false, error: selector ? 'No element matches ' + selector : 'No clickable element has the label ' + text };
  if (target.disabled === true) return { ok: false, error: 'Element is disabled' };
  target.scrollIntoView({ block: 'center', inline: 'center' });
  target.click();
  return { ok: true, clicked: cssPath(target), label: label(target), url: String(location.href) };
`);

export const buildTypeScript = ({ selector, value, submit }: { selector: string; value: string; submit: boolean }): string => wrap(`
  var selector = ${JSON.stringify(selector)};
  var value = ${JSON.stringify(value)};
  var target = null;
  try { target = document.querySelector(selector); }
  catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
  if (!target) return { ok: false, error: 'No element matches ' + selector };
  var editable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (!editable || target.disabled === true || target.readOnly === true) return { ok: false, error: 'Field is not editable' };
  target.scrollIntoView({ block: 'center' });
  target.focus();
  if (target.isContentEditable) target.textContent = value;
  else {
    var prototype = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (setter && setter.set) setter.set.call(target, value);
    else target.value = value;
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  if (${submit ? 'true' : 'false'}) {
    var enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
    target.dispatchEvent(new KeyboardEvent('keydown', enter));
    target.dispatchEvent(new KeyboardEvent('keyup', enter));
    if (target.form && typeof target.form.requestSubmit === 'function') target.form.requestSubmit();
  }
  return { ok: true, selector: cssPath(target), url: String(location.href) };
`);

export const buildScrollScript = ({ selector, direction }: { selector?: string; direction?: string }): string => wrap(`
  var selector = ${JSON.stringify(selector ?? '')};
  var direction = ${JSON.stringify(direction ?? '')};
  if (selector) {
    var target = null;
    try { target = document.querySelector(selector); }
    catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
    if (!target) return { ok: false, error: 'No element matches ' + selector };
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
  } else {
    var page = Math.round(window.innerHeight * 0.85);
    var bottom = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (direction === 'down') window.scrollTo({ top: window.scrollY + page, behavior: 'instant' });
    else if (direction === 'up') window.scrollTo({ top: window.scrollY - page, behavior: 'instant' });
    else if (direction === 'top') window.scrollTo({ top: 0, behavior: 'instant' });
    else if (direction === 'bottom') window.scrollTo({ top: bottom, behavior: 'instant' });
    else return { ok: false, error: 'Unknown scroll direction: ' + direction };
  }
  return new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      var maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      resolve({ ok: true, scrollY: Math.round(window.scrollY), maxScrollY: Math.round(maxScrollY) });
    }); });
  });
`);

const INSPECTED_STYLES = [
  'color', 'background-color', 'background-image', 'opacity', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'text-align', 'border-radius',
  'border-width', 'border-style', 'border-color', 'box-shadow', 'display', 'position',
  'width', 'height', 'padding', 'margin', 'gap', 'flex-direction', 'justify-content',
  'align-items', 'z-index', 'overflow', 'visibility',
];

export const buildInspectScript = ({ selector }: { selector: string }): string => wrap(`
  var selector = ${JSON.stringify(selector)};
  var target = null;
  try { target = document.querySelector(selector); }
  catch (error) { return { ok: false, error: 'Invalid selector: ' + selector }; }
  if (!target) return { ok: false, error: 'No element matches ' + selector };
  var computed = window.getComputedStyle(target);
  var styles = {};
  var properties = ${JSON.stringify(INSPECTED_STYLES)};
  for (var i = 0; i < properties.length; i += 1) {
    var value = computed.getPropertyValue(properties[i]);
    if (value) styles[properties[i]] = String(value).trim();
  }
  var rect = target.getBoundingClientRect();
  return {
    ok: true,
    selector: cssPath(target),
    tag: target.tagName.toLowerCase(),
    label: label(target),
    bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
    styles: styles
  };
`);

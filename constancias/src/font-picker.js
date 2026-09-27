/** A searchable font picker. Previews are loaded only when they are visible. */
export function createFontPicker({mount, getFonts, getSelected, loadFont, onSelect, onOpen, isBusy = () => false}) {
  if (!mount) throw new Error('Falta el contenedor del selector de fuentes.');
  const uid = `font-picker-${++pickerCount}`;
  const sampleText = 'Aa Áj · Matemáticas 0123';
  let fonts = [], filtered = [], fontMap = new Map(), activeId = null;
  let opened = false, disabled = false, destroyed = false, applying = null, running = 0;
  let frame = 0, searchFrame = 0, lastSelected;
  const cache = new Map(), optionNodes = new Map(), queue = [];
  const listeners = [];
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const listen = (node, type, fn, options) => {
    node.addEventListener(type, fn, options);
    listeners.push(() => node.removeEventListener(type, fn, options));
  };
  const normalize = value => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const host = el('div', 'font-picker');
  const trigger = el('button', 'font-picker__trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${uid}-list`);
  const triggerText = el('span', 'font-picker__trigger-text');
  const triggerName = el('span', 'font-picker__name');
  const triggerSample = el('span', 'font-picker__trigger-sample');
  triggerSample.setAttribute('aria-hidden', 'true');
  triggerText.append(triggerName, triggerSample);
  const chevron = el('span', 'font-picker__chevron', '⌄');
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(triggerText, chevron);
  host.append(trigger);
  mount.append(host);

  const popup = el('div', 'font-picker__popup');
  popup.hidden = true;
  const searchBox = el('div', 'font-picker__search-box');
  const search = el('input', 'font-picker__search');
  search.type = 'search';
  search.placeholder = 'Buscar una fuente…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-label', 'Buscar una fuente');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-controls', `${uid}-list`);
  search.setAttribute('aria-expanded', 'false');
  const count = el('span', 'font-picker__count');
  count.setAttribute('aria-live', 'polite');
  searchBox.append(search, count);
  const list = el('div', 'font-picker__list');
  list.id = `${uid}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Fuentes disponibles');
  const empty = el('p', 'font-picker__empty', 'No se encontraron fuentes con ese nombre.');
  empty.hidden = true;
  popup.append(searchBox, list, empty);
  document.body.append(popup);

  function blocked() { return disabled || Boolean(isBusy()) || Boolean(applying); }
  function currentFont(id) { return fontMap.get(id); }
  function isNearViewport(id) {
    if (!opened || popup.hidden) return false;
    const node = optionNodes.get(id);
    if (!node?.isConnected) return false;
    const rect = node.getBoundingClientRect(), root = list.getBoundingClientRect();
    return rect.bottom > root.top - 110 && rect.top < root.bottom + 110;
  }
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    if (!opened || destroyed) return;
    for (const entry of entries) if (entry.isIntersecting) requestPreview(entry.target.dataset.fontId);
  }, {root: list, rootMargin: '110px 0px', threshold: 0}) : null;

  function requestPreview(id) {
    if (!id || !currentFont(id) || cache.get(id)?.status === 'error') return;
    ensureFont(id).catch(() => {});
  }
  function ensureFont(id, retry = false) {
    let item = cache.get(id);
    if (item && !(retry && item.status === 'error')) {
      if (item.status === 'pending') pump();
      return item.promise;
    }
    let resolve, reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    item = {status: 'pending', promise, resolve, reject, family: null};
    cache.set(id, item);
    queue.push(id);
    paintOption(id);
    pump();
    return promise;
  }
  function pump() {
    if (destroyed) return;
    while (running < 3) {
      const next = queue.findIndex(id => currentFont(id) && (id === getSelected() || id === applying || isNearViewport(id)));
      if (next < 0) break;
      const [id] = queue.splice(next, 1), item = cache.get(id);
      if (!item || item.status !== 'pending') continue;
      item.status = 'loading';
      running++;
      paintOption(id);
      Promise.resolve().then(() => loadFont(id)).then(font => {
        const family = font?.family || currentFont(id)?.family;
        if (!family) throw new Error('La fuente no está disponible.');
        item.status = 'loaded';
        item.family = family;
        item.resolve(font);
      }).catch(error => {
        item.status = 'error';
        item.reject(error);
      }).finally(() => {
        running--;
        if (!destroyed) {
          paintOption(id);
          if (id === getSelected()) paintTrigger();
          pump();
        }
      });
    }
  }
  function setSample(node, item, compact = false) {
    const ready = item?.status === 'loaded';
    node.classList.toggle('is-ready', ready);
    node.classList.toggle('is-error', item?.status === 'error');
    node.style.fontFamily = ready ? `"${item.family.replace(/["\\]/g, '\\$&')}"` : '';
    node.textContent = ready ? sampleText : item?.status === 'error' ? 'Vista previa no disponible' : compact ? 'Preparando vista previa…' : 'Cargando vista previa…';
  }
  function paintTrigger() {
    const id = getSelected(), font = currentFont(id), item = cache.get(id);
    triggerName.textContent = font?.label || 'Selecciona una fuente';
    trigger.setAttribute('aria-label', `Fuente: ${font?.label || 'sin seleccionar'}`);
    triggerSample.hidden = !font;
    setSample(triggerSample, item, true);
    trigger.disabled = disabled || Boolean(isBusy());
  }
  function paintOption(id) {
    const node = optionNodes.get(id);
    if (!node) return;
    node.setAttribute('aria-selected', String(id === getSelected()));
    node.classList.toggle('is-active', id === activeId);
    node.classList.toggle('is-applying', id === applying);
    setSample(node.querySelector('.font-picker__sample'), cache.get(id));
    const status = node.querySelector('.font-picker__option-status');
    if (id === applying) status.textContent = 'Aplicando…';
    else if (node.dataset.selectionError) status.textContent = 'No se pudo aplicar. Intenta de nuevo.';
    else status.textContent = id === getSelected() ? 'Seleccionada' : '';
  }
  function setActive(id, scroll = false) {
    const old = activeId;
    activeId = id;
    if (old) paintOption(old);
    if (id) paintOption(id);
    const node = optionNodes.get(id);
    if (node) {
      search.setAttribute('aria-activedescendant', node.id);
      if (scroll) {
        const top = node.offsetTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + node.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + node.offsetHeight - list.clientHeight;
        scheduleVisible();
      }
    } else search.removeAttribute('aria-activedescendant');
  }
  function renderOptions(preserveScroll = false) {
    const scroll = preserveScroll ? list.scrollTop : 0;
    const query = normalize(search.value.trim());
    filtered = fonts.filter(font => normalize(font.label).includes(query));
    observer?.disconnect();
    optionNodes.clear();
    const fragment = document.createDocumentFragment();
    filtered.forEach((font, index) => {
      const node = el('div', 'font-picker__option');
      node.id = `${uid}-option-${index}`;
      node.dataset.fontId = font.id;
      node.setAttribute('role', 'option');
      node.setAttribute('aria-label', font.label);
      const heading = el('div', 'font-picker__option-heading');
      const name = el('span', 'font-picker__name', font.label);
      const status = el('span', 'font-picker__option-status');
      heading.append(name, status);
      const sample = el('span', 'font-picker__sample');
      sample.setAttribute('aria-hidden', 'true');
      node.append(heading, sample);
      optionNodes.set(font.id, node);
      fragment.append(node);
    });
    list.replaceChildren(fragment);
    count.textContent = `${filtered.length} ${filtered.length === 1 ? 'fuente' : 'fuentes'}`;
    empty.hidden = filtered.length > 0;
    if (!optionNodes.has(activeId)) activeId = optionNodes.has(getSelected()) ? getSelected() : filtered[0]?.id || null;
    for (const font of filtered) {
      paintOption(font.id);
      observer?.observe(optionNodes.get(font.id));
    }
    setActive(activeId);
    list.scrollTop = scroll;
    scheduleVisible();
  }
  function scheduleVisible() {
    if (frame || !opened || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!opened || destroyed) return;
      for (const font of filtered) if (isNearViewport(font.id)) requestPreview(font.id);
      pump();
    });
  }
  function positionPopup() {
    if (!opened) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const offsetTop = viewport?.offsetTop || 0, offsetLeft = viewport?.offsetLeft || 0;
    const width = Math.min(Math.max(rect.width, 310), viewportWidth - 16);
    const left = Math.max(offsetLeft + 8, Math.min(rect.left, offsetLeft + viewportWidth - width - 8));
    const below = offsetTop + viewportHeight - rect.bottom - 14;
    const above = rect.top - offsetTop - 14;
    const opensAbove = below < 250 && above > below;
    const available = Math.max(130, opensAbove ? above : below);
    const maxListHeight = Math.max(65, Math.min(320, available - 69));
    popup.style.width = `${width}px`;
    list.style.maxHeight = `${maxListHeight}px`;
    popup.style.left = `${left}px`;
    popup.style.top = `${opensAbove ? Math.max(offsetTop + 8, rect.top - popup.offsetHeight - 6) : rect.bottom + 6}px`;
  }
  function open() {
    if (destroyed || blocked()) return;
    opened = true;
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.setAttribute('aria-expanded', 'true');
    renderOptions(true);
    positionPopup();
    search.focus({preventScroll: true});
    if (!search.value && activeId === getSelected()) setActive(activeId, true);
    scheduleVisible();
    if (onOpen) Promise.resolve().then(() => onOpen()).catch(() => {});
  }
  function close(restoreFocus = false) {
    if (!opened) return;
    opened = false;
    popup.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    if (restoreFocus && !trigger.disabled) trigger.focus({preventScroll: true});
  }
  async function choose(id) {
    if (blocked() || !currentFont(id)) return;
    applying = id;
    paintOption(id);
    search.disabled = true;
    list.setAttribute('aria-busy', 'true');
    let succeeded = false;
    try {
      await ensureFont(id, true);
      const result = await onSelect(id);
      succeeded = result !== false;
      if (!succeeded) throw new Error('No se pudo aplicar la fuente.');
    } catch {
      const node = optionNodes.get(id);
      if (node) node.dataset.selectionError = 'true';
    } finally {
      applying = null;
      search.disabled = disabled;
      list.removeAttribute('aria-busy');
      if (!destroyed) {
        sync();
        paintOption(id);
        if (succeeded) close(true);
        else if (opened && !disabled) search.focus({preventScroll: true});
      }
    }
  }
  function moveActive(delta, edge) {
    if (!filtered.length) return;
    const index = filtered.findIndex(font => font.id === activeId);
    const target = edge === 'start' ? 0 : edge === 'end' ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, (index < 0 ? -1 : index) + delta));
    setActive(filtered[target].id, true);
  }
  listen(trigger, 'click', () => opened ? close() : open());
  listen(trigger, 'keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    }
  });
  listen(search, 'input', () => {
    cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(() => { searchFrame = 0; renderOptions(); positionPopup(); });
  });
  listen(search, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if ((event.key === 'Home' || event.key === 'End') && (!search.value || event.ctrlKey || event.metaKey)) {
      event.preventDefault(); moveActive(0, event.key === 'Home' ? 'start' : 'end');
    } else if (event.key === 'Enter') { event.preventDefault(); if (activeId) choose(activeId); }
  });
  listen(list, 'click', event => {
    const node = event.target.closest('[data-font-id]');
    if (node && list.contains(node)) { setActive(node.dataset.fontId); choose(node.dataset.fontId); }
  });
  listen(list, 'pointermove', event => {
    if (event.pointerType === 'touch' || applying) return;
    const node = event.target.closest('[data-font-id]');
    if (node && list.contains(node)) setActive(node.dataset.fontId);
  });
  listen(list, 'mousedown', event => event.preventDefault());
  listen(list, 'scroll', scheduleVisible, {passive: true});
  listen(document, 'pointerdown', event => {
    if (opened && !popup.contains(event.target) && !host.contains(event.target)) close();
  });
  listen(document, 'focusin', event => {
    if (opened && !popup.contains(event.target) && !host.contains(event.target)) close();
  });
  listen(window, 'resize', () => { positionPopup(); scheduleVisible(); }, {passive: true});
  listen(window, 'scroll', event => { if (!popup.contains(event.target)) positionPopup(); }, {passive: true, capture: true});
  if (window.visualViewport) {
    listen(window.visualViewport, 'resize', () => { positionPopup(); scheduleVisible(); });
    listen(window.visualViewport, 'scroll', positionPopup);
  }

  function sync() {
    if (destroyed) return;
    const selected = getSelected();
    paintTrigger();
    if (lastSelected) paintOption(lastSelected);
    if (selected) paintOption(selected);
    if (selected !== lastSelected && !opened) activeId = selected;
    lastSelected = selected;
    requestPreview(selected);
  }
  function refresh() {
    if (destroyed) return;
    fonts = [...getFonts()];
    fontMap = new Map(fonts.map(font => [font.id, font]));
    sync();
    if (opened) { renderOptions(true); positionPopup(); }
  }
  function setDisabled(value) {
    disabled = Boolean(value);
    trigger.disabled = disabled;
    search.disabled = disabled || Boolean(applying);
    list.setAttribute('aria-disabled', String(disabled));
    if (disabled && !applying) close();
  }
  function destroy() {
    destroyed = true;
    observer?.disconnect();
    cancelAnimationFrame(frame);
    cancelAnimationFrame(searchFrame);
    for (const off of listeners) off();
    host.remove();
    popup.remove();
  }
  refresh();
  return {refresh, sync, setDisabled, destroy};
}

let pickerCount = 0;

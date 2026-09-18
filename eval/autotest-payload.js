(function () {
  const out = [];
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [].slice.call(document.querySelectorAll(s));
  const log = (k, v) => { out.push(k + ': ' + v); paint(); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const msg = (m) => new Promise((res) => chrome.runtime.sendMessage(m, res));
  function paint() {
    const el = document.getElementById('RESULT');
    if (el) el.textContent = out.join('\n');
  }

  async function run() {
    await sleep(400);
    await msg({ type: 'START_SEARCH_SESSION', intent: '广州三日游' });
    if (window.FocusGuardPanel) FocusGuardPanel.setTab('inbox');

    const itinerary = [
      '广州三日游',
      '第1站：花城广场→海心沙亚运公园→广州塔→珠江夜游码头→二沙岛艺术公园',
      '第2站：陈家祠→荔湾湖公园→永庆坊→上下九步行街→沙面岛',
      '第3站：中山纪念堂→越秀公园→南越王博物院→北京路步行街→大佛寺',
      '-',
      '✌广州美食',
      '🔥南村柴火鸡饭'
    ].join('\n');
    await msg({ type: 'ADD_CLIP', clip: { title: '广州三日游', text: itinerary, source: 'paste' } });
    await sleep(300);
    if (window.FocusGuardPanel) await FocusGuardPanel.refresh();
    log('inbox_cards', $$('#nb .fgp-card').length);
    log('tabs_before', $$('#nb .fgp-tab').map((t) => t.textContent.trim()).join('|'));
    log('organize_label', (($('#nb .fgp-pill.is-go') || {}).textContent || '(没有)').trim());

    const go = $('#nb .fgp-pill.is-go');
    if (go) go.click();
    for (let i = 0; i < 80 && $$('#nb .fgp-tab').length < 2; i++) await sleep(80);
    await sleep(200);
    log('tabs_after', $$('#nb .fgp-tab').map((t) => t.textContent.trim().replace('×', '')).join('|'));
    log('ai_cards', $$('#nb .fgp-card').length);
    log('titled_cards', $$('#nb .fgp-card-t').map((t) => t.textContent.trim()).join('|'));
    log('redo_pill', Boolean($('#nb .fgp-pill.is-redo')));
    log('redo_link', Boolean($('#nb .fgp-redo-link')));
    log('redo_copy', (($('#nb .fgp-pill.is-redo') || {}).textContent || '').trim());
    log('chips', $$('#nb .fgp-chip').map((t) => t.textContent.trim()).join('|'));

    let sess = (await msg({ type: 'GET_SESSION' })).session || {};
    log('all_analyzed', (sess.clips || []).every((c) => c.analyzed));
    log('clip_still_in_inbox', (sess.clips || []).length);
    log('board_names', JSON.stringify((sess.boards || []).map((b) => b.name)));
    const firstCard = ((((sess.boards || [])[0] || {}).cards) || [])[0];
    log('has_derived_card', Boolean(firstCard && firstCard.body));

    if (firstCard) {
      await msg({ type: 'EDIT_CARD', cardId: firstCard.id, title: firstCard.title, body: '用户改过的正文' });
      await sleep(100);
      const r = await msg({ type: 'REDO_ROUND' });
      sess = (r.session || (await msg({ type: 'GET_SESSION' })).session) || {};
      const survived = (sess.boards || []).some((b) => (b.cards || []).some((c) => c.edited && c.body === '用户改过的正文'));
      log('edited_survived_redo', survived);
    } else {
      log('edited_survived_redo', false);
    }

    const longBody = '广州3天2晚速通（70%成功）：'
      + ('下午一点到白云机场，取行李+航站楼摆渡公交+地铁3号线折腾到三点多才到酒店。').repeat(20);
    const longAdd = await msg({ type: 'ADD_CLIP', clip: { title: '很长的一篇攻略', text: longBody, source: 'paste' } });
    await sleep(200);
    if (window.FocusGuardPanel) {
      FocusGuardPanel.setTab('inbox');
      await FocusGuardPanel.refresh();
    }
    log('long_add_ok', longAdd && longAdd.ok);
    const stored = ((longAdd && longAdd.session && longAdd.session.clips) || [])
      .filter((c) => c.title === '很长的一篇攻略')[0] || {};
    log('long_src_chars', longBody.length);
    log('long_stored_chars', (stored.text || '').length);
    const longEl = $$('#nb .fgp-card-b').filter((el) => el.textContent.indexOf('广州3天2晚速通') === 0)[0];
    log('long_in_dom', Boolean(longEl));
    log('long_dom_chars', longEl ? longEl.textContent.length : 0);

    const md = await msg({ type: 'EXPORT_MD' });
    log('export_ok', Boolean(md && md.ok && md.markdown && md.markdown.indexOf('# 广州三日游') === 0));

    const back = document.querySelector('.back');
    if (back) back.click();
    await sleep(200);
    const cards = $$('#feed .card, .card');
    const mapCard = cards.filter((c) => /分为3个板块|一张图|分区/.test(c.textContent))[0] || cards[1];
    if (mapCard) mapCard.click();
    await sleep(400);
    const img = document.getElementById('clue-map');
    log('clue_map_found', Boolean(img));
    if (img && !img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
    log('clue_map_natural', img ? (img.naturalWidth + 'x' + img.naturalHeight) : '');
    log('clue_map_is_real_image', Boolean(img && img.tagName === 'IMG' && img.naturalWidth > 100));

    const panel = $('#nb .fgp-body');
    log('drop_target_found', Boolean(panel));
    if (img && panel) {
      const dt = new DataTransfer();
      img.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      panel.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      panel.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
    for (let i = 0; i < 80 && !document.querySelector('#nb .fgp-card-img'); i++) await sleep(80);
    log('thumb_from_real_drop', Boolean(document.querySelector('#nb .fgp-card-img')));

    const added = await msg({
      type: 'ADD_IMAGE_CLIP',
      url: img ? img.src : '',
      title: '广州可以分为3个板块'
    });
    log('add_image_ok', added && added.ok);
    if (added && added.clip && added.clip.image) {
      const im = added.clip.image;
      log('stored_image', im.width + 'x' + im.height + '  from ' + im.origW + 'x' + im.origH
        + '  stored_kb=' + Math.round(im.bytes / 1024));
    }
    if (window.FocusGuardPanel) await FocusGuardPanel.refresh();
    log('thumbs_in_inbox', $$('#nb .fgp-card-img').length);

    const fin = await msg({ type: 'FINISH_SEARCH' });
    if (fin && fin.note) {
      log('note_image_clips', (fin.note.clips || []).filter((c) => c.image).length);
      log('note_kept_all_clips', (fin.note.clips || []).length);
      const entry = window.FocusGuardLib.noteIndexEntry(fin.note);
      log('index_entry_bytes', JSON.stringify(entry).length);
      log('index_has_base64', JSON.stringify(entry).includes('base64'));
    } else {
      log('finish_failed', JSON.stringify(fin));
    }
    log('DONE', 'ok');
    return out;
  }

  window.__fgAutotest = () => run().catch((e) => {
    out.push('ERROR: ' + (e && e.message));
    paint();
    throw e;
  });
})();

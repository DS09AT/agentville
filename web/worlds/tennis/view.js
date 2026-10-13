(() => {
  'use strict';
  const { matchesOf, readShared, direction, hash, DESK, racketOffset, racketFlip, PLAYER_SIZE, PLAYER_ANCHOR, BALL_LIFT, guestsOf, seats, COURT } = Agentville.tennisView;
  const extras = new Map(), main = new Map(), balls = new Map(), machines = new Map(), boards = new Map(), bags = new Map(), netSticks = new Map(), canopies = [];
  const sheets = { players: { path: 'assets/players.png', cols: 4, rows: 4 },idle:{path:'assets/idle-walk.png',cols:7,rows:4},drink:{path:'assets/drink-poses.png',cols:4,rows:2},reach:{path:'assets/reach.png',cols:2,rows:1}, poses: { path: 'assets/poses.png', cols: 4, rows: 2 }, rest: {path:'assets/rest-extra.png',cols:4,rows:2}, umpire: { path: 'assets/umpire-track.png', cols: 4, rows: 2 } };
  let disposed = false, reception = null, visualTime = null, visualSignature = '', visualState = null;
  const release = object => { object.removeFromParent(); object.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); if (o.userData.ownTexture) o.material?.map?.dispose(); o.dispose?.(); }); };
  function prune(map, keep) { for (const [id, v] of map) if (!keep.has(id)) { v.isObject3D ? release(v) : v.dispose(); map.delete(id); } }
  function visual(ctx) {
    const signature = (ctx.scene?.agents ?? []).map(a => `${a.id}:${a.state}:${a.repo}`).join('|') + (ctx.scene?.subagents ?? []).map(a => `${a.id}:${a.state}`).join('|');
    if (ctx.time !== visualTime || signature !== visualSignature || !visualState || !Object.keys(visualState.courts).length && !Object.keys(visualState.social).length) { visualState = readShared(ctx.shared); visualTime = ctx.time; visualSignature = signature; }
    return visualState;
  }
  const dataOf = (ctx, id) => { const shared = visual(ctx); return shared.social[id] ?? Object.values(shared.courts).filter(c=>c.active).flatMap(c => Object.entries(c.players)).find(([key]) => key === id)?.[1]; };

  function avatar(ctx, id, color, role = null) {
    const object = new ctx.THREE.Group(), loaded = new Map(), stridePhase = (hash(id) % 100) / 10;
    let gone = false, data = null, cup = null, bubble = null, cupAsked = false;
    function getSheet(key) {
      if (loaded.has(key)) return loaded.get(key);
      loaded.set(key, null);
      const sheet = sheets[key];
      ctx.assets.sprite(sheet.path, key==='reach'?[3.15,3.15]:key === 'idle'?[2.05,2.05]:key === 'umpire' ? [2.1,2.1] : key !== 'players' ? [2.4,2.4] : PLAYER_SIZE).then(mesh => {
        if (gone || disposed) { release(mesh); return; }
        mesh.position.set(0, .25, PLAYER_ANCHOR); mesh.visible = false;
        if (key !== 'umpire') {
          mesh.material.onBeforeCompile = shader => {
            shader.uniforms.shirt = { value: new ctx.THREE.Color(color ?? '#4a7bd0') };
            shader.fragmentShader = 'uniform vec3 shirt;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nif (diffuseColor.b > diffuseColor.r * 1.4 && diffuseColor.b > diffuseColor.g * 1.15) diffuseColor.rgb = shirt * max(0.45, diffuseColor.b);');
            // Hide the atlas's painted balls while retaining the original player outfits.
            if (key === 'players') shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
              vec2 atlasPixel = vec2(vMapUv.x, 1.0 - vMapUv.y) * vec2(1230.0,1278.0);
              if (distance((atlasPixel-vec2(1174.0,181.0))/vec2(18.0,17.0),vec2(0.0)) < 1.0 ||
                  distance((atlasPixel-vec2(1177.0,461.0))/vec2(18.0,17.0),vec2(0.0)) < 1.0 ||
                  distance((atlasPixel-vec2(1176.0,761.0))/vec2(18.0,17.0),vec2(0.0)) < 1.0 ||
                  distance((atlasPixel-vec2(1174.0,1059.0))/vec2(18.0,17.0),vec2(0.0)) < 1.0) discard;
            `);
          };
          mesh.material.customProgramCacheKey = () => `club-shirt-${key}`;
        }
        object.add(mesh); loaded.set(key, mesh); ctx.invalidate();
      }).catch(err => console.error(`${sheet.path}: ${err.message}`));
      return null;
    }
    return {
      object, compactTags: true,
      get quietTags() { return role !== 'player' && !['working', 'waiting', 'turn'].includes(ctx.scene?.agents.find(a => a.id === id)?.state); },
      get headOffset() { return data?.pose === 'lie' ? 2.6 : ['sit', 'sip', 'chat', 'umpire'].includes(data?.pose) ? 1.25 : 1.7; },
      setData(next) { data = next; },
      animate(move, t) {
        data = role ? data : dataOf(ctx, id);
        const a = ctx.scene?.agents.find(a => a.id === id),waiting=a&&['waiting','turn'].includes(a.state)&&!a.nap;
        if(waiting)data=null;
        const striking = ['serve', 'forehand', 'backhand', 'volley', 'smash'].includes(data?.pose), walking = move === 'walk' && !striking;
        const heading = object.rotation.y; object.rotation.y = 0;
        const face = waiting&&!walking?'south':walking && !data?.stance ? direction(Math.sin(heading), Math.cos(heading)) : data?.face ?? direction(Math.sin(heading), Math.cos(heading));
        const pose = walking ? 'walk' : data?.pose ?? (a?.state === 'working' ? 'ready' : 'stand');
        const chair = data?.seatType === 'chair' && data?.arrived, lying = ['lie','lie-sip','lie-hold'].includes(pose),tableSeat=seats.find(s=>s.key===data?.seat),reaching=lying&&tableSeat?.tableAt&&['reach','setdown'].includes(data?.glassMode);
        const drinking=data?.drink&&data?.arrived&&(!lying||pose!=='lie'||!tableSeat?.tableAt);
        const key = data?.role === 'umpire' || role === 'umpire' ? 'umpire' : reaching?'reach':drinking?'drink':chair || lying ? 'rest' : ['sit','chat','pour','pickup'].includes(pose)?'poses':data?.role==='guest'||data?.role==='ball-person'||waiting?'idle':'players';
        const mesh = getSheet(key);
        for (const [name, m] of loaded) if (m) m.visible = name === key;
        if (!mesh) return;
        const sheet = sheets[key]; let row = { south: 0, north: 1, west: 2, east: 3 }[face], col = 0;
        if (key === 'umpire') { const frame=pose==='net-call'?4:pose==='call'?3:pose==='write'?5:data?.gaze??1;row=Math.floor(frame/4);col=frame%4; }
        else if(key==='idle'){col=walking?1+Math.floor(t*6+stridePhase)%2:0;if(data?.drink)col+=3;if(pose==='receive')col=3;}
        else if(key==='drink'){row=['sip','lie-sip'].includes(pose)?0:1;col=lying?3:face==='east'?1:face==='west'?2:0;}
        else if(key==='reach'){row=0;const seat=seats.find(s=>s.key===data.seat);col=seat?.tableAt[0]>data.x?0:1;}
        else if (key === 'rest') {row=chair?1:0;col=chair?(pose==='sip'?face==='east'?2:3:face==='east'?0:1):pose==='lie-sip'?3:data?.rest??0;}
        else if (walking) col = 1 + Math.floor(t * (data?.stance ? 4 : 7) + stridePhase) % 2;
        else if (key === 'players') col = ['serve', 'forehand', 'backhand', 'volley', 'smash'].includes(pose) ? 3 : 0;
        else {
          row = pose === 'pour' || pose === 'pickup' || pose === 'drink' || pose === 'sip' ? 1 : 0;
          col = pose === 'lie' ? 3 : pose === 'pour' ? 2 : pose === 'pickup' ? 3 : face === 'west' || face === 'east' && row === 1 ? 1 : face === 'east' && row === 0 ? 2 : 0;
        }
        const width = mesh.material.map.image.width / sheet.cols, height = mesh.material.map.image.height / sheet.rows;
        mesh.userData.frame([col * width, row * height, width, height]);
        const flip = key==='idle'&&data?.drink&&(face==='south'&&col===3||face==='north'&&col===5)?-1:key === 'players' && striking ? racketFlip(face, pose === 'backhand' || data?.backhand) : key === 'poses' && row === 1 && col === 1 && face === 'east' ? -1 : 1;
        mesh.scale.set(flip*(key==='players'?1:width/height), 1, 1);
        mesh.position.z = key==='umpire'?-.8:chair?-.35:lying?-.45:PLAYER_ANCHOR;
        mesh.renderOrder = (data?.role==='guest'&&!data?.kiosk&&object.position.x>19.25&&object.position.x<24.75&&object.position.z>=10.75?6.3:5) + object.position.z * .001;
        mesh.material.color.set(a?.state === 'stale' ? '#b5c2b3' : '#ffffff');
        if (data?.drink && !cupAsked) { cupAsked = true; ctx.assets.sprite('assets/glasses.png',[.42,.42]).then(m => { if (gone || disposed) { release(m); return; } cup=m;m.renderOrder=7;object.add(m);ctx.invalidate(); }); }
        if (cup) {
          cup.visible=Boolean(data?.drink);
          if(cup.visible){const img=cup.material.map.image,w=img.width/3,h=img.height/2,frame=4-(data.drinkLevel??4);cup.userData.frame([(frame%3)*w,Math.floor(frame/3)*h,w,h]);cup.scale.x=w/h;
            const held={south:[[.34,.58],[.66,.61],[.63,.56]],north:[[.63,.56],[.66,.61],[.34,.56]],west:[[.4,.58],[.43,.59],[.44,.6]],east:[[.63,.58],[.61,.59],[.62,.59]]};
            const uv=key==='idle'?held[face][Math.max(0,Math.min(2,col-3))]:key==='reach'?[col===0?.8:.2,.55]:key==='drink'?(row===0?[[.43,.55],[.61,.54],[.4,.54],[.43,.55]]:[[.48,.58],[.56,.58],[.47,.58],[.45,.59]])[col]:[.48,.58],size=key==='idle'?2.05:key==='reach'?3.15:2.4;
            const hand={x:(uv[0]-.5)*size*mesh.scale.x,z:mesh.position.z+(uv[1]-.5)*size-.16};
            const seat=seats.find(s=>s.key===data.seat),table=seat?.tableAt?{x:seat.tableAt[0]+(seat.tableAt[0]>data.x?-.3:.3)-object.position.x,z:seat.tableAt[1]-.28-object.position.z}:hand,counter={x:0,z:9.9-object.position.z};
            let start=hand,end=hand,amount=data.glassT??1;
            if(data.glassMode==='table')start=end=table;else if(data.glassMode==='reach'){start=table;end=hand;}else if(data.glassMode==='setdown'){start=hand;end=table;}else if(data.glassMode==='receive'){start=counter;end=hand;}else if(data.glassMode==='give'){start=hand;end=counter;}
            cup.position.set(start.x+(end.x-start.x)*amount,.4,start.z+(end.z-start.z)*amount);
          }
        }
        if (data?.buddy && !bubble) {
          bubble = conversationBubble(ctx); bubble.position.set(.35, .5, -2.0); bubble.renderOrder = 8; object.add(bubble);
        }
        if (bubble) bubble.visible = Boolean(data?.buddy && pose === 'chat');

      },
      setStale() {}, setKids() {},
      dispose() { gone = true; release(object); main.delete(id); },
    };
  }
  async function prop(ctx, rect, size) { return ctx.assets.sprite('assets/amenities.png', size, rect); }
  async function cellProp(ctx, col, row, size) {
    const rects = { '1:0': [525,98,550,398], '2:0': [1125,125,390,382], '1:1': [440,575,225,365] };
    return prop(ctx, rects[`${col}:${row}`], size).then(mesh => { mesh.renderOrder = 3; return mesh; });
  }
  function letters(ctx, lines, size, ink = null) {
    const canvas = document.createElement('canvas'); canvas.width = lines.length === 1 ? 64 : 96; canvas.height = lines.length === 1 ? 14 : 40;
    const texture = new ctx.THREE.CanvasTexture(canvas); texture.magFilter = texture.minFilter = ctx.THREE.NearestFilter; texture.generateMipmaps = false; texture.colorSpace = ctx.THREE.SRGBColorSpace;
    const mesh = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(size[0], size[1]).rotateX(-Math.PI / 2), new ctx.THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    mesh.userData.ownTexture = true; mesh.renderOrder = 4;
    mesh.userData.write = next => {
      const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height);
      next.forEach((line, j) => {
        const width = Agentville.pixelText.textWidth(line) ?? 90; let x = Math.round((canvas.width - width) / 2);
        for (const ch of line) { const glyph = Agentville.pixelText.glyphOf(ch); if (!glyph) continue; g.fillStyle = ink ?? (j === 0 ? '#f6ce6a' : '#fff3d6'); glyph.rows.forEach((bits, y) => { for (let i = 0; i < glyph.w; i++) if (bits & (1 << (glyph.w - 1 - i))) g.fillRect(x + i, Math.round((canvas.height - next.length * 12 + 5) / 2) + j * 12 + y, 1, 1); }); x += glyph.w + 1; }
      }); texture.needsUpdate = true;
    };
    mesh.userData.write(lines); return mesh;
  }
  function conversationBubble(ctx) {
    const c = document.createElement('canvas'); c.width = 18; c.height = 12; const g = c.getContext('2d');
    g.fillStyle = '#4e3626'; g.fillRect(0, 0, 18, 10); g.fillRect(3, 10, 3, 2); g.fillStyle = '#fff3d6'; g.fillRect(1, 1, 16, 8); g.fillStyle = '#4e3626'; for (const x of [4, 8, 12]) g.fillRect(x, 4, 2, 2);
    const texture = new ctx.THREE.CanvasTexture(c); texture.magFilter = texture.minFilter = ctx.THREE.NearestFilter; texture.generateMipmaps = false;
    const mesh = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(.8, .5).rotateX(-Math.PI / 2), new ctx.THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })); mesh.userData.ownTexture = true; return mesh;
  }
  function scoreText(m) { return ['A   B', `S ${m.score.sets.join(' : ')}  G ${m.score.games.join(' : ')}`, m.score.winner === null ? m.points.join(' : ') : `WIN ${m.score.winner ? 'B' : 'A'}`]; }
  function scoreDetail(m) {
    const s = m.score, names = m.teams.map(t => t.map(id => m.names[id] ?? id).join(' + '));
    return [`${m.mode === 'training' ? 'Ball machine training' : m.mode === 'doubles' ? 'Doubles' : 'Singles'} · Git points only`, ...names.map((n, i) => `${i ? 'B' : 'A'} · ${n}: ${s.sets[i]} sets · ${s.games[i]} games · ${m.points[i]}`), m.mode === 'training' ? 'Feeder: stationary ball machine' : `Serving: ${m.names[s.order[s.server]] ?? 'Player'}`, ...m.helpers.map(h => `${m.names[h.id]}: ${h.role === 'umpire' ? 'umpire' : 'ball person'}`), ...(m.last ? [`Latest Git point: ${m.last.kind} ${m.last.ok ? 'succeeded' : 'failed'} · ${m.names[m.last.actor] ?? 'Player'}`] : ['No confirmed Git point in this encounter yet.']), 'The repo label shows commit history and changed files; these totals are not new scoring events.', 'Simulated rallies do not change this score.'].join('\n');
  }
  Agentville.view({
    setup(ctx) {
      ctx.assets.texture('assets/hardcourt.png').then(texture=>{texture.wrapT=ctx.THREE.RepeatWrapping;texture.repeat.y=COURT.baseline/COURT.doubles;texture.needsUpdate=true;ctx.invalidate();});
      for (const [bed,[x,z]] of ctx.world.plots.at.entries()) {
        const group=new ctx.THREE.Group();group.position.set(x,.15,z);ctx.root.add(group);netSticks.set(bed,group);
        for(const sign of [-1,1])ctx.assets.sprite('assets/court-net.png',[.075*COURT.scale,COURT.netTop*BALL_LIFT+.05],[73,283,38,167]).then(mesh=>{if(disposed){release(mesh);return;}mesh.position.set(sign*COURT.singlesStick,0,-COURT.netTop*BALL_LIFT/2);mesh.renderOrder=3;group.add(mesh);ctx.invalidate();});
      }
      ctx.assets.texture('assets/lawn.png').then(texture => { texture.wrapS = texture.wrapT = ctx.THREE.MirroredRepeatWrapping; texture.repeat.set(5, 11.25); texture.needsUpdate = true; ctx.invalidate(); });
      const group = new ctx.THREE.Group(); group.position.set(DESK[0], .2, DESK[1]); ctx.root.add(group); reception = group;
      cellProp(ctx, 2, 0, [4.4, 3.0]).then(mesh => { if (disposed) { release(mesh); return; } group.add(mesh); const name = letters(ctx, ['RECEPTION'], [3.8, .85], '#4e3626'); name.position.set(0, .12, -.4); group.add(name); ctx.invalidate(); });
      // Only the canopy occludes seated heads; the chairs and table remain behind the people.
      for(const x of [31,39,47]) ctx.assets.sprite('assets/club.png',[5,205/285*5],[34,601,285,205]).then(mesh=>{if(disposed){release(mesh);return;}mesh.position.set(x,.42,4+205/285*2.5);mesh.renderOrder=6;ctx.root.add(mesh);canopies.push(mesh);ctx.invalidate();});
      for(const [rect,z]of [[[20,64,460,154],6.501],[ [20,343,460,163],9.452]])ctx.assets.sprite('assets/amenities.png',[4.8,rect[3]/442*4.6],rect).then(mesh=>{if(disposed){release(mesh);return;}mesh.position.set(22,.43,z);mesh.renderOrder=6;ctx.root.add(mesh);canopies.push(mesh);ctx.invalidate();});
      for(const s of seats.filter(s=>s.tableAt))ctx.assets.sprite('assets/glasses.png',[1.1,1.1]).then(mesh=>{if(disposed){release(mesh);return;}const img=mesh.material.map.image,w=img.width/3,h=img.height/2;mesh.userData.frame([2*w,h,w,h]);mesh.scale.x=w/h;mesh.position.set(s.tableAt[0],.2,s.tableAt[1]);mesh.renderOrder=3.2;ctx.root.add(mesh);canopies.push(mesh);ctx.invalidate();});
    },
    figure(ctx, agent) { const made = avatar(ctx, agent.id, agent.color); main.set(agent.id, made); return made; },
    frame(ctx, dt) {
      const state = visual(ctx), matches = matchesOf(ctx.scene), actors = new Map([...(ctx.scene?.agents ?? []), ...(ctx.scene?.subagents ?? [])].map(a => [a.id, a]));
      const present = new Set(), busy = new Set(), fed = new Set(), keepBoards = new Set(), keepBags = new Set();
      for (const [repo, m] of Object.entries(matches)) {
        const c = ctx.plotOf(repo); if (!c) continue;
        keepBoards.add(repo);
        let board = boards.get(repo);
        if (!board) {
          board = new ctx.THREE.Group(); board.position.set(c.x, .2, c.z + COURT.board); ctx.root.add(board); boards.set(repo, board);
          cellProp(ctx, 1, 0, [4.4, 3.0]).then(mesh => { if (disposed || boards.get(repo) !== board) { release(mesh); return; } board.add(mesh); const display = letters(ctx, scoreText(m), [3.1, 1.2]); display.position.set(0, .12, -.55); board.add(display); board.userData.display = display; board.userData.score = ''; ctx.invalidate(); });
        }
        board.position.set(c.x,.2,c.z+COURT.board);
        const text = scoreText(m), signature = JSON.stringify(text);
        if (board.userData.display && signature !== board.userData.score) { board.userData.display.userData.write(text); board.userData.score = signature; }
        const sticks=netSticks.get(c.bed);if(sticks)sticks.visible=m.mode!=='doubles';
        const game = state.courts[c.bed]; if (!game?.active) continue;
        busy.add(repo);
        const expectedBags=new Set(m.teams.flat().filter(id=>id!=='@machine').map(id=>`${repo}:${id}`));
        for(const [key,bag]of bags)if(bag.userData.repo===repo&&!expectedBags.has(key)){release(bag);bags.delete(key);}
        const corners=[[-5.7,COURT.board-.7],[5.7,COURT.board-.7],[-5.7,COURT.board+.7],[5.7,COURT.board+.7]], used=new Set([...bags.values()].filter(b=>b.userData.repo===repo).map(b=>b.userData.slot));
        for(const id of m.teams.flat().filter(id=>id!=='@machine').sort()){
          const key=`${repo}:${id}`;keepBags.add(key);
          const previous=bags.get(key);
          if(previous){if(previous.userData.bed!==c.bed){previous.position.x+=c.x-previous.userData.x;previous.position.z+=c.z-previous.userData.z;Object.assign(previous.userData,{bed:c.bed,x:c.x,z:c.z});}continue;}
          let slot=hash(id+repo)%4;while(used.has(slot))slot=(slot+1)%4;used.add(slot);
          const at=corners[slot],jitter=((hash(repo)%7)-3)*.04,bag=new ctx.THREE.Group();bag.position.set(c.x+at[0]+jitter,.2,c.z+at[1]+((hash(id)%5)-2)*.06);bag.userData={repo,slot,bed:c.bed,x:c.x,z:c.z};ctx.root.add(bag);bags.set(key,bag);
          ctx.assets.sprite('assets/club.png',[1.2,1.05],[628,662,271,235]).then(mesh=>{if(disposed||bags.get(key)!==bag){release(mesh);return;}mesh.renderOrder=3.2;bag.add(mesh);ctx.invalidate();});
        }
        for (const [id, p] of Object.entries(game.players)) {
          if (id === m.parent || main.has(id)) continue; present.add(id);
          if (!extras.has(id)) { const a = avatar(ctx, id, actors.get(id)?.color ?? actors.get(m.parent)?.color, p.role); a.object.position.set(p.x, 0, p.z); ctx.root.add(a.object); extras.set(id, a); }
          const a = extras.get(id), dx = p.x - a.object.position.x, dz = p.z - a.object.position.z, k = dt ? 1 - Math.exp(-dt * 16) : 1;
          a.object.position.x += dx * k; a.object.position.z += dz * k; a.object.rotation.y = p.moving ? Math.atan2(dx, dz) : 0;
          a.setData(p); a.animate(p.moving ? 'walk' : 'idle', ctx.time);
        }
        if (game.mode === 'training') {
          fed.add(repo);
          if (!machines.has(repo)) { const group = new ctx.THREE.Group(); group.position.set(game.machine.x, .25, game.machine.z); ctx.root.add(group); machines.set(repo, group); ctx.assets.sprite('assets/club.png', [1.4, 1.9], [405, 358, 152, 245]).then(mesh => { if (disposed || machines.get(repo) !== group) { release(mesh); return; } mesh.renderOrder = 3; group.add(mesh); ctx.invalidate(); }); }
          machines.get(repo).position.set(game.machine.x,.25,game.machine.z);
        }
        if (!balls.has(repo)) {
          const group = new ctx.THREE.Group(), liveBall = new ctx.THREE.Group(); group.add(liveBall); group.userData.liveBall = liveBall; ctx.root.add(group); balls.set(repo, group);
          ctx.assets.sprite('assets/ball.png', [.38, .38]).then(mesh => { if (disposed || balls.get(repo) !== group) { release(mesh); return; } mesh.renderOrder = 9; liveBall.add(mesh); const loose = new ctx.THREE.InstancedMesh(mesh.geometry.clone(), mesh.material.clone(), 8); loose.renderOrder = 3.5; loose.count = 0; group.add(loose); group.userData.loose = loose; ctx.invalidate(); });
        }
        const group = balls.get(repo), ball = group.userData.liveBall; ball.visible = Boolean(game.ball && !game.ball.hidden);
        if (group.userData.loose) { const loose = group.userData.loose, matrix = new ctx.THREE.Matrix4(); loose.count = game.loose?.length ?? 0; (game.loose ?? []).forEach((p, i) => loose.setMatrixAt(i, matrix.makeTranslation(p.x, .16, p.z))); loose.instanceMatrix.needsUpdate = true; }
        if (game.ball) {
          const hitter = main.get(game.hitter) ?? extras.get(game.hitter), p = game.players[game.hitter];
          if (game.phase === 'impact' && hitter && p) {
            const at = racketOffset(p.face, p.pose === 'backhand' || p.backhand);
            ball.position.set(hitter.object.position.x + at.x, .6, hitter.object.position.z + at.z);
          } else ball.position.set(game.ball.x, .6, game.ball.z - game.ball.y * BALL_LIFT);
        }
      }
      prune(extras, present); prune(balls, busy); prune(machines, fed); prune(boards, keepBoards);prune(bags,keepBags);
    },
    labels(ctx) {
      const first = (ctx.scene?.agents ?? []).find(a => a.state === 'waiting') ?? (ctx.scene?.agents ?? []).find(a => a.state === 'turn' && !a.nap);
      const labels = [{ key:'reception',x:DESK[0],z:DESK[1]-.4,size:[4,1.2],inWorld:true,text:'RECEPTION',title:'Reception: agents waiting for you',agent:first?.id,detail:'No agent is waiting at reception.' }], matches = matchesOf(ctx.scene), state = visual(ctx);
      const extra = Math.max(0,guestsOf(ctx.scene).length-10);
      if(extra) labels.push({key:'resting-more',x:24,z:14.5,text:`+${extra} resting`,title:`${extra} additional resting agents`,detail:`The recreation area shows at most ten real resting agents. ${extra} more remain available in the agent list.`});
      const more=(ctx.scene?.repos??[]).filter(r=>!ctx.plotOf(r.key)).length;if(more)labels.push({key:'courts-more',x:25,z:129,text:`+${more} courts`,title:'Additional repos',detail:'The club has nine courts. Other repos remain available in the repo list.'});
      for (const [repo, m] of Object.entries(matches)) {
        const c = ctx.plotOf(repo); if (!c) continue;
        labels.push({ key: `score:${c.bed}`, x: c.x, z: c.z + COURT.board-.55, size: [3.3, 1.25], inWorld: true, text: scoreText(m).join('\n'), title: m.teams.map(t => t.map(id => m.names[id]).join(' + ')).join(' vs '), detail: scoreDetail(m) });
        for (const [id, p] of Object.entries(state.courts[c.bed]?.players ?? {})) if (id !== m.parent) labels.push({ key: `sub:${id}`, x: p.x, z: p.z - 1.6, text: p.role === 'umpire' ? p.call || 'UMP' : p.role === 'ball-person' ? 'BALL' : p.team === 0 ? 'A' : 'B', title: `${m.names[id]} · ${p.role}${p.call?' · simulated '+p.call:''}`, agent: m.parent });
      }
      return labels;
    },
    dispose() { disposed = true; prune(extras, new Set()); prune(balls, new Set()); prune(machines, new Set()); prune(boards, new Set());prune(bags,new Set());prune(netSticks,new Set());for(const mesh of canopies)release(mesh); if (reception) release(reception); },
  });
})();

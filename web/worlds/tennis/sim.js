(() => {
  'use strict';
  const A = Agentville, courts = new Map(), social = new Map();
  let routed = false;
  // ITF dimensions in metres, mapped uniformly to the pixel world's ground.
  const METRE=.8, COURT={scale:METRE,baseline:23.77/2*METRE,singles:8.23/2*METRE,doubles:10.97/2*METRE,service:6.4*METRE,runback:6.4*METRE,siderun:3.66*METRE,netCentre:.914*METRE,netTop:1.07*METRE,ballRadius:.0335*METRE};
  COURT.netPost=COURT.doubles+.914*METRE;COURT.singlesStick=COURT.singles+.914*METRE;
  COURT.netClear=COURT.netPost+.55;COURT.feeder=COURT.baseline+1.3;COURT.board=COURT.baseline+COURT.runback+1.75;COURT.chair=-COURT.netPost-.9;
  const G=9.81*METRE,BASE=COURT.baseline,SERVICE=COURT.service,HALF={singles:COURT.singles,doubles:COURT.doubles,training:COURT.singles};
  const spread=BASE/5.415, distance=n=>n*spread;
  function netHeight(x,mode){const post=mode==='doubles'?COURT.netPost:COURT.singlesStick;return COURT.netCentre+(COURT.netTop-COURT.netCentre)*Math.min(1,Math.abs(x)/post);}
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = id => { let n = 0; for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0; return n; };
  const direction = (dx, dz) => Math.abs(dx) > Math.abs(dz) ? dx > 0 ? 'east' : 'west' : dz >= 0 ? 'south' : 'north';
  const round = n => Math.round(n * 64) / 64;
  const PLAYER_SIZE = [2.4, 2.5], PLAYER_ANCHOR = -.85, BALL_LIFT = .42;
  // String-bed centres measured in the unchanged players.png strike cells.
  const RACKETS = { south: [211.4, 157.5], north: [223.2, 117.1], west: [199.7, 128.7], east: [207.2, 88.4] };
  const racketFlip = (face, backhand) => face === 'west' || backhand && (face === 'north' || face === 'south') ? -1 : 1;
  function racketOffset(face, backhand = false) {
    const [x, z] = RACKETS[face];
    return { x: (x / 307.5 - .5) * PLAYER_SIZE[0] * racketFlip(face, backhand), z: (z / 319.5 - .5) * PLAYER_SIZE[1] + PLAYER_ANCHOR };
  }
  function contact(p, height) {
    const offset = racketOffset(p.face, p.pose === 'backhand' || p.backhand);
    return { x: p.x + offset.x, z: p.z + offset.z + height * BALL_LIFT, y: height };
  }
  const BAR = [22, 9], COUNTER = [22, 11.4], DESK = [17, 14.4];
  const guestsOf = scene => (scene?.agents ?? []).filter(a => a.nap || a.state === 'idle' || a.state === 'stale').sort((a,b) => Number(Boolean(a.nap))-Number(Boolean(b.nap)) || hash(a.id)-hash(b.id) || a.id.localeCompare(b.id));
  const seats = [
    ...[31, 39, 47].flatMap((x, table) => [{ key: `table${table}a`, x: x - 1.35, z: 8.4, face: 'east', type: 'chair', table }, { key: `table${table}b`, x: x + 1.35, z: 8.4, face: 'west', type: 'chair', table }]),
    ...[30, 35, 40, 45].flatMap((x, i) => [-.55, .55].map((dx, j) => ({ key: `bench${i}${j}`, x: x + dx, z: 12.9, face: 'south', type: 'bench', table: 3 + i }))),
    ...[21.2, 25.8, 30.4, 35, 39.6, 44.2, 48.8].map((x, i) => ({ key: `lounge${i}`, x, z: 18.2, face: 'south', type: 'lounge', table: 10 + i })),
  ];
  const KIOSK=[19.25,24.75,5.3,10.75], DOOR=[22,4.8];
  for(const s of seats){s.access=s.type==='chair'?[s.x,10.5]:s.type==='bench'?[s.x,14.3]:[s.x-1.6,18.4];if(s.type==='lounge'&&s.x<47)s.tableAt=[s.x+1.6,18];}
  const REC_BLOCKS=[KIOSK,...[31,39,47].map(x=>[x-2.85,x+2.85,3.65,10.1]),...[30,35,40,45].map(x=>[x-2.05,x+2.05,11.22,13.78]),...[21.2,25.8,30.4,35,39.6,44.2,48.8].map(x=>[x-1.45,x+1.45,15.925,20.075]),...seats.filter(s=>s.tableAt).map(s=>[s.tableAt[0]-.85,s.tableAt[0]+.85,17.15,18.85])];
  const inside=(p,r)=>p[0]>r[0]&&p[0]<r[1]&&p[1]>r[2]&&p[1]<r[3];
  function crosses(a,b,r){
    let lo=0,hi=1;
    for(const [axis,min,max]of [[0,r[0],r[1]],[1,r[2],r[3]]]){const d=b[axis]-a[axis];if(Math.abs(d)<1e-9){if(a[axis]<=min||a[axis]>=max)return false;}else{const t=(min-a[axis])/d,u=(max-a[axis])/d;lo=Math.max(lo,Math.min(t,u));hi=Math.min(hi,Math.max(t,u));}}
    return hi>lo+1e-8&&hi>0&&lo<1;
  }
  const navCache=new WeakMap();
  function routeRects(from,to,rects,bounded=false){
    const free=(a,b)=>!rects.some(r=>crosses(a,b,r)),valid=p=>(!bounded||p[0]>=19.4&&p[0]<=49.4&&p[1]>=4&&p[1]<=19.8)&&!rects.some(r=>inside(p,r));
    if(Math.hypot(from[0]-to[0],from[1]-to[1])<.04)return[to];
    if(!valid(to))return[];if(free(from,to))return[to];
    let graph=navCache.get(rects)?.[bounded?1:0];
    if(!graph){const points=rects.flatMap(r=>[[r[0]-.01,r[2]-.01],[r[1]+.01,r[2]-.01],[r[0]-.01,r[3]+.01],[r[1]+.01,r[3]+.01]]).filter(valid),edges=points.map(()=>[]);
      points.forEach((a,i)=>points.slice(i+1).forEach((b,j)=>{if(free(a,b)){const n=i+j+1,d=Math.hypot(a[0]-b[0],a[1]-b[1]);edges[i].push([n,d]);edges[n].push([i,d]);}}));graph={points,edges};if(!navCache.has(rects))navCache.set(rects,[]);navCache.get(rects)[bounded?1:0]=graph;}
    const nodes=[...graph.points,from,to],start=nodes.length-2,end=start+1,edges=graph.edges.map(e=>[...e]);edges.push([],[]);
    for(let i=0;i<start;i++)for(const j of[start,end])if(free(nodes[i],nodes[j])){const d=Math.hypot(nodes[i][0]-nodes[j][0],nodes[i][1]-nodes[j][1]);edges[i].push([j,d]);edges[j].push([i,d]);}
    const cost=nodes.map(()=>Infinity),prev=nodes.map(()=>-1),done=new Set();cost[start]=0;
    for(;;){let n=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(n<0||cost[i]<cost[n]))n=i;if(n<0||cost[n]===Infinity)return[];if(n===end)break;done.add(n);for(const [j,d]of edges[n])if(cost[n]+d<cost[j]){cost[j]=cost[n]+d;prev[j]=n;}}
    const out=[];for(let n=end;n!==start;n=prev[n])out.unshift(nodes[n]);return out;
  }
  function furnitureRoute(from,to,personRect=null,bounded=true){
    const rects=personRect?[...REC_BLOCKS,personRect]:REC_BLOCKS,start=inside(from,KIOSK),end=inside(to,KIOSK);
    if(start&&end)return[to];
    const path=routeRects(start?DOOR:from,end?DOOR:to,rects,bounded);
    return path.length?[...(start?[DOOR]:[]),...path,...(end?[to]:[])]:[];
  }

  function matchesOf(scene) {
    if (Object.keys(scene?.tennis ?? {}).length) return scene.tennis;
    const out = {};
    for (const a of scene?.agents ?? []) {
      if (a.state !== 'working' || !a.repo || out[a.repo]) continue;
      const ids = (scene.subagents ?? []).filter(s => s.by === a.id && s.state === 'running').sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.id.localeCompare(b.id)).map(s => s.id);
      const doubles = ids.length >= 3, teams = doubles ? [[a.id, ids[1]], [ids[0], ids[2]]] : [[a.id], [ids[0] ?? '@machine']];
      out[a.repo] = { parent: a.id, mode: doubles ? 'doubles' : ids.length ? 'singles' : 'training', active: true, teams,
        helpers: ids.slice(doubles ? 3 : 1).map((id, i) => ({ id, role: doubles && i === 0 ? 'umpire' : 'ball-person' })),
        names: Object.fromEntries([[a.id, a.name], ['@machine', 'Ball machine'], ...(scene.subagents ?? []).map(s => [s.id, s.label || s.type || 'Subagent'])]),
        points: ['0', '0'], score: { points: [0, 0], sets: [0, 0], games: [0, 0], server: 0, order: doubles ? [a.id, ids[0], ids[1], ids[2]] : [a.id, ids[0] ?? '@machine'], ends: 0, winner: null, results: [] }, history: [], last: null };
    }
    return out;
  }
  const south = (m, team) => m.mode === 'training' ? team === 0 : (team === 0) !== Boolean(m.score.ends);
  function positions(m, court) {
    const out = {}, server = m.mode === 'training' ? '@machine' : m.score.order[m.score.server], side = (m.score.points[0] + m.score.points[1]) % 2 ? -1 : 1;
    m.teams.forEach((team, t) => team.forEach((id, i) => {
      const sign = south(m, t) ? 1 : -1, isServer = id === server;
      out[id] = { x: court.x + distance(team.length === 2 ? i === 0 ? 1 : -1 : side) * sign,
        z: court.z + sign * (isServer ? BASE + .2 : i === 1 ? distance(1.65) : distance(4.3)), face: sign > 0 ? 'north' : 'south', team: t, role: 'player', lane: team.length === 2 ? (i === 0 ? 1 : -1) * sign : 0 };
    }));
    if (m.mode === 'training') out['@machine'] = { x: court.x, z: court.z - COURT.feeder, face: 'south', team: 1, role: 'machine' };
    m.helpers.forEach((h, i) => { const j = m.helpers.filter(p => p.role === 'ball-person').findIndex(p => p.id === h.id), corners = [[COURT.netPost,BASE+1],[-COURT.netPost,-BASE-1],[-COURT.netPost,BASE+1],[COURT.netPost,-BASE-1]], at = h.role === 'umpire' ? [COURT.chair,.2] : corners[j] ?? [COURT.netPost,-BASE+(j-4)*.6]; out[h.id] = { x:court.x+at[0],z:court.z+at[1],face:h.role==='umpire'?'east':'north',role:h.role }; });
    return out;
  }
  function player(id, at) {
    const seed = hash(id);
    return { ...at, id, tx: at.x, tz: at.z, speed: (2.5 + (seed % 7) * .17) * (at.role === 'player' || at.role === 'ball-person' ? spread : 1), accuracy: .87 + (seed % 5) * .016, style: ['baseline', 'net', 'counter', 'attack'][seed % 4], pose: 'ready', moving: false, strikeUntil: 0, step: 'other' };
  }
  function aroundNets(from, way, barriers) {
    const rects=barriers.map(c=>[c.x-COURT.netClear,c.x+COURT.netClear,c.z-.85,c.z+.85]),out=[];let start=from;
    for(const target of way){out.push(...routeRects(start,target,rects));start=target;}
    return out;
  }
  function move(p, dt, time, barriers = [], people = []) {
    if (time < p.strikeUntil || time < (p.reactAt ?? 0)) { p.moving = false; return; }
    if(Math.hypot(p.tx-p.x,p.tz-p.z)<.04){p.moving=false;p.way=null;if(p.pose==='walk')p.pose=p.role==='player'?'ready':'stand';return;}
    let target = [p.tx,p.tz];
    if (p.role==='guest'||barriers.length && !p.stance) {
      if (!p.way || Math.hypot(p.tx-p.routeGoal[0],p.tz-p.routeGoal[1]) > .35) { p.way = p.role==='guest'?furnitureRoute([p.x,p.z],target):aroundNets([p.x,p.z],[target],barriers); p.routeGoal = target; }
      else if (p.way.length) p.way[p.way.length-1] = target;
      while(p.way.length && Math.hypot(p.way[0][0]-p.x,p.way[0][1]-p.z)<.04){p.x=p.way[0][0];p.z=p.way[0][1];p.way.shift();}
      if(!p.way.length){p.moving=false;return;}target = p.way[0];
    } else p.way = null;
    const dx = target[0] - p.x, dz = target[1] - p.z, d = Math.hypot(dx, dz), k = Math.min(1, p.speed * dt / Math.max(d, .001));
    const blocked=people.find(q=>q.id!==p.id&&!q.arrived&&Math.hypot(p.x+dx*k-q.x,p.z+dz*k-q.z)<.75&&Math.hypot(p.x+dx*k-q.x,p.z+dz*k-q.z)<=Math.hypot(p.x-q.x,p.z-q.z));
    if(blocked){p.moving=false;p.pose='stand';if(time>=(p.avoidAt??0)){
      const obstacle=[blocked.x-.78,blocked.x+.78,blocked.z-.78,blocked.z+.78],internal=inside([p.x,p.z],KIOSK)||inside(target,KIOSK),detour=internal?routeRects([p.x,p.z],target,[...REC_BLOCKS.filter(r=>r!==KIOSK),obstacle],true):furnitureRoute([p.x,p.z],[p.tx,p.tz],obstacle);
      if(detour.length)p.way=internal?[...detour,...p.way.slice(1)]:detour;
      else if(p.id>blocked.id||!blocked.moving){
        const length=Math.max(.001,Math.hypot(p.x-blocked.x,p.z-blocked.z)),away=[(p.x-blocked.x)/length,(p.z-blocked.z)/length],directions=[away,[away[1],-away[0]],[-away[1],away[0]],[0,1],[1,0],[-1,0],[0,-1]];
        for(const dir of directions){const point=[p.x+dir[0]*.9,p.z+dir[1]*.9];if(point[0]<19.4||point[0]>49.4||point[1]<4||point[1]>19.8||REC_BLOCKS.some(r=>(!internal||r!==KIOSK)&&crosses([p.x,p.z],point,r))||people.some(q=>q.id!==p.id&&!q.arrived&&Math.hypot(point[0]-q.x,point[1]-q.z)<.82))continue;
          // Yielding changes the origin; the old remaining segment may cross a bench.
          const rest=furnitureRoute(point,[p.tx,p.tz]);if(rest.length){p.way=[point,...rest];break;}
        }
      }
      p.avoidAt=time+1;
    }return;}
    if(p.role==='guest'&&REC_BLOCKS.some(r=>(r!==KIOSK||!inside([p.x,p.z],KIOSK)&&!inside(target,KIOSK))&&crosses([p.x,p.z],[p.x+dx*k,p.z+dz*k],r))){p.moving=false;p.way=null;return;}
    p.moving = d > .04;
    if (p.moving) { p.x += dx * k; p.z += dz * k; if (!p.stance) p.face = direction(dx, dz); p.pose = 'walk'; }
    else if (time >= p.strikeUntil && ['walk', 'forehand', 'backhand', 'volley', 'serve', 'smash'].includes(p.pose)) p.pose = p.role === 'player' ? 'ready' : 'stand';
  }
  function launch(game, from, target, duration, team, kind, serve = false) {
    game.ball = { x: from.x, z: from.z, y: from.y ?? .7, vx: (target.x - from.x) / duration, vz: (target.z - from.z) / duration,
      vy: (.035 - (from.y ?? .7) + G * duration * duration / 2) / duration, team, bounces: 0, serve, kind, live: true };
    game.receiver = null; game.intercept = null; game.planned = false; game.phase = 'flight';
  }
  function advanceBall(b, dt) {
    const landing = (b.vy + Math.sqrt(b.vy * b.vy + 2 * G * Math.max(0, b.y - .035))) / G;
    const t = Math.min(dt, landing);
    b.x += b.vx * t; b.z += b.vz * t; b.y += b.vy * t - G * t * t / 2; b.vy -= G * t;
    if (landing > dt) return null;
    b.y = .035; b.bounces++;
    const bounce = { x: b.x, z: b.z };
    b.vy = Math.abs(b.vy) * .62; b.vx *= .92; b.vz *= .92;
    const rest = dt - t;
    b.x += b.vx * rest; b.z += b.vz * rest; b.y += b.vy * rest - G * rest * rest / 2; b.vy -= G * rest;
    return bounce;
  }
  function end(game, reason, now, random) {
    game.phase = 'dead'; game.call = reason; game.next = now + 1.6 + random() * 1.2; game.ball.live = false;
    if (game.match.mode === 'training') game.next = now + 3.2 + random() * 2.2;
    if (reason === 'fault' || reason === 'net' && game.ball.serve) {
      game.secondServe = !game.secondServe;
      if (!game.secondServe) game.call = 'double fault';
    } else if (reason !== 'let') game.secondServe = false;
    const umpire = Object.values(game.players).find(p => p.role === 'umpire');
    if (umpire) { umpire.pose = 'call'; umpire.call = reason === 'let' ? 'Let' : game.call === 'double fault' ? 'Double fault' : ['fault','out'].includes(reason) ? reason === 'fault' ? 'Fault' : 'Out' : reason === 'missed' ? 'Not up' : 'Net error'; umpire.strikeUntil = now + 1.3; }
  }
  function reset(game, now) {
    if (game.ball && !game.ball.hidden && !game.ball.live) { game.loose.push({ x: clamp(game.ball.x, game.court.x - COURT.doubles-1.1, game.court.x + COURT.doubles+1.1), z: clamp(game.ball.z, game.court.z - BASE-1.7, game.court.z + BASE+1.7) }); game.loose = game.loose.slice(-8); }
    game.ball = null;
    const initial = positions(game.match, game.court);
    for (const [id, p] of Object.entries(game.players)) if (initial[id]) { p.tx = initial[id].x; p.tz = initial[id].z; p.lane = initial[id].lane; p.backhand = false; p.reactAt = now; p.pose = p.role === 'umpire' ? 'umpire' : 'ready'; }
    game.phase = game.match.mode === 'training' && now >= game.collectAfter && game.loose.length > 2 ? 'collect' : game.match.mode === 'training' ? 'feed' : 'prepare';
    if(game.phase==='collect'){game.collectLeft=2;game.pickupTarget=null;}
    game.next = now + (game.match.mode === 'training' ? 2.3 : 1.1); game.receiver = null;
  }
  function recover(game, p) {
    const sign = south(game.match, p.team) ? 1 : -1, style = /^(test|lint|read|search)$/.test(p.step) ? 'counter' : /^(push|deploy|build)$/.test(p.step) ? 'attack' : p.style;
    const incomingX = game.shot?.target.x ?? game.court.x;
    p.tx = game.court.x + (p.lane ? p.lane * clamp(distance(.9) + (incomingX - game.court.x) * p.lane * .18, distance(.65), distance(1.4)) : clamp((incomingX - game.court.x) * .25, -distance(.65), distance(.65)));
    p.tz = game.court.z + sign * distance(game.match.mode === 'doubles' && game.match.teams[p.team].indexOf(p.id) === 1 ? style === 'counter' ? 2.6 : 1.7 : style === 'net' ? 2.4 : style === 'attack' ? 3.7 : 4.4);
  }
  function planReturn(game, now) {
    const m = game.match, c = game.court, receiving = 1 - game.ball.team;
    const candidates = m.teams[receiving].map(id => game.players[id]).filter(Boolean);
    if (game.ball.serve) candidates.splice(0, candidates.length, candidates[(m.score.points[0] + m.score.points[1]) % candidates.length]);
    let plan = null;
    const b = { ...game.ball }, dt = .025;
    for (let t = dt; t < 3 && b.bounces < 2; t += dt) {
      advanceBall(b, dt);
      if (b.y < .25 || b.y > 1.3 || b.bounces >= 2) continue;
      for (const p of [...candidates].sort((a, p) => Math.hypot(a.x-b.x,a.z-b.z)-Math.hypot(p.x-b.x,p.z-b.z))) {
        const sign = south(m, p.team) ? 1 : -1, face = sign > 0 ? 'north' : 'south', react = .22 + hash(p.id) % 5 * .025;
        const netPlayer = p.style === 'net' || m.mode === 'doubles' && m.teams[p.team].indexOf(p.id) === 1;
        if ((b.z - c.z) * sign < .6 || !b.bounces && (b.serve || !netPlayer)) continue;
        const hands = [false, true].sort((a, bHand) => Math.abs(b.x - racketOffset(face,a).x - p.x) - Math.abs(b.x - racketOffset(face,bHand).x - p.x));
        for (const backhand of hands) {
          const offset = racketOffset(face, backhand), x = b.x - offset.x, z = b.z - b.y * BALL_LIFT - offset.z;
          if (Math.abs(x - c.x) > HALF[m.mode] + .35 || p.lane && (x - c.x) * p.lane < .3 || (z - c.z) * sign < 1 || (z - c.z) * sign > BASE + .8) continue;
          if (Math.hypot(p.x - x, p.z - z) > p.speed * Math.max(0, t - react) + .025) continue;
          plan = { id: p.id, x, z, face, backhand, at: now + t, reactAt: now + react };
          break;
        }
        if (plan) break;
      }
      if (plan) break;
    }
    game.intercept = plan; game.receiver = plan?.id ?? null;
    for (const p of Object.values(game.players).filter(p => p.role === 'player')) {
      if (p.id === plan?.id) { p.tx = plan.x; p.tz = plan.z; p.reactAt = plan.reactAt; }
      else if (p.team === receiving) { recover(game, p); p.tx = c.x + p.lane * clamp(distance(1.15) - Math.abs((plan?.x ?? b.x) - c.x) * .18, distance(.55), distance(1.2)); p.reactAt = now + .4; }
    }
    game.planned = true;
  }
  function strike(game, p, now, random) {
    const b = game.ball, attacking = /^(push|deploy|write|build)$/.test(p.step) || p.style === 'attack';
    const sign = south(game.match, p.team) ? -1 : 1, width = HALF[game.match.mode], pressure = Math.hypot(p.x - game.court.x, p.z - game.court.z) * (.006/spread);
    const kind = b.y > 1.05 ? 'smash' : b.bounces === 0 ? 'volley' : /^(read|search|test|lint)$/.test(p.step) ? 'slice' : random() < .16 ? 'drop' : attacking ? 'drive' : random() < .2 ? 'lob' : 'topspin';
    let x = game.court.x + (random() * 2 - 1) * (width - distance(.55)), z = game.court.z + sign * distance(kind === 'drop' ? 1.25 + random() * .6 : 2.9 + random() * 1.0);
    if (random() > clamp(p.accuracy + .08 - pressure, .94, .98)) { if (random() < .6) x = game.court.x + (x > game.court.x ? 1 : -1) * (width + .4); else z = game.court.z + sign * (BASE+.85); }
    const speed = distance(kind === 'lob' ? 4.5 : kind === 'drop' ? 5 : attacking ? 8.5 : 6.6);
    const duration = clamp(Math.hypot(x - b.x, z - b.z) / speed, .9, 2.1);
    const backhand = game.intercept.backhand;
    p.moving = false; p.backhand = backhand; p.pose = kind === 'smash' || kind === 'volley' ? kind : backhand ? 'backhand' : 'forehand'; p.strikeUntil = now + .36; p.face = game.intercept.face;
    Object.assign(b, contact(p, b.y));
    game.shot = { player: p.id, target: { x, z }, duration, kind, low: random() < .045 };
    game.phase = 'impact'; game.next = now + .1;
  }
  function stepCourt(game, dt, now, random) {
    const m = game.match, c = game.court, players = Object.values(game.players);
    if (!m.active || game.entering) return;
    for (const p of players.filter(p => p.role === 'umpire')) {
      const b = game.ball;
      if (b?.live) p.gaze = b.x < p.x ? b.z < p.z ? 6 : 7 : b.z < c.z - 1 ? 0 : b.z > c.z + 1 ? 2 : 1;
      if (now >= p.strikeUntil) { p.pose = 'umpire'; p.call = ''; }
    }
    for (const p of players.filter(p => p.role === 'player')) { p.stance = !game.entering && game.phase !== 'collect' && (p.z-c.z)*(south(m,p.team)?1:-1)>=1; if (p.stance) p.face = south(m, p.team) ? 'north' : 'south'; }
    for (const p of players) move(p, dt, now, [c]);
    if (game.phase === 'impact') {
      const p = game.players[game.shot.player]; Object.assign(game.ball, contact(p, game.ball.y));
      if (now >= game.next) {
        const shot = game.shot; launch(game, game.ball, shot.target, shot.duration, p.team, shot.kind, Boolean(shot.serve));
        if (shot.low) {
          const b = game.ball, t = (c.z-b.z)/b.vz;
          if(t>0) b.vy = (netHeight(b.x+b.vx*t-c.x,m.mode)-(shot.serve ? .025 : .2)-b.y+G*t*t/2)/t;
        }
        recover(game, p);
      }
      return;
    }
    if (game.phase === 'collect') {
      const p = game.players[m.parent];
      if (!game.loose.length || game.collectLeft === 0) { game.collectAfter = now + 150 + random() * 60; reset(game, now); return; }
      if (now < p.strikeUntil) return;
      const ball = game.pickupTarget ?? game.loose.reduce((a,b) => Math.hypot(p.x-b.x,p.z-b.z)<Math.hypot(p.x-a.x,p.z-a.z)?b:a);
      game.pickupTarget=ball;p.tx=ball.x;p.tz=Math.abs(ball.z-c.z)<.9&&Math.abs(ball.x-c.x)<COURT.netClear?c.z+(p.z>=c.z?1:-1)*.95:ball.z;
      if (Math.hypot(p.x-p.tx,p.z-p.tz)<.15) { game.loose.splice(game.loose.indexOf(ball),1);game.pickupTarget=null;if(game.collectLeft!==undefined)game.collectLeft--; p.pose = 'pickup'; p.strikeUntil = now + .65; }
      return;
    }
    if (game.phase === 'prepare' && now >= game.next) {
      const server = game.players[m.score.order[m.score.server]], sign = south(m, server.team) ? -1 : 1, side = (m.score.points[0] + m.score.points[1]) % 2 ? -1 : 1;
      if (Math.hypot(server.x - server.tx, server.z - server.tz) > .4) { game.next = now + .1; return; }
      server.backhand = false; server.pose = 'serve'; server.strikeUntil = now + .65;
      game.ball = { x: server.x, z: server.z, y: .8, live: true, team: server.team, serve: true, kind: 'serve', bounces: 0, vx: 0, vz: 0, vy: 0 };
      game.target = { x: c.x - side * (south(m, server.team) ? 1 : -1) * distance(.6 + random() * .7), z: c.z + sign * distance(1.1 + random() * 1.3) };
      if (!game.secondServe && random() < .12) game.target.z = c.z + sign * (SERVICE+.85);
      game.phase = 'toss'; game.next = now + .55; return;
    }
    if (game.phase === 'toss') {
      game.ball.y = .8 + Math.sin(clamp(1 - (game.next - now) / .55, 0, 1) * Math.PI) * 1.2;
      if (now >= game.next) {
        const server = game.players[m.score.order[m.score.server]];
        Object.assign(game.ball, contact(server, 1.6)); server.strikeUntil = now + .36; server.moving = false;
        game.shot = { player: server.id, target: game.target, duration: game.secondServe ? 1.35 : 1.12, kind: 'serve', serve: true, low: random() < .04 };
        game.phase = 'impact'; game.next = now + .1;
      }
      return;
    }
    if (game.phase === 'feed' && now >= game.next) {
      const p=game.players[m.parent];if((p.z-c.z)<1||Math.hypot(p.x-p.tx,p.z-p.tz)>.2)return;
      const target = { x: c.x + (random() * 2 - 1) * (COURT.singles-.4), z: c.z + distance(2.9 + random() * 1.6) };
      launch(game, { x: c.x, z: c.z - COURT.feeder, y: .5 }, target, 1.35 + random() * .4, 1, 'feed'); return;
    }
    if (game.phase === 'dead') {
      game.ball.x += game.ball.vx * dt; game.ball.z += game.ball.vz * dt; game.ball.y = Math.max(.035, game.ball.y + game.ball.vy * dt); game.ball.vy -= G * dt; game.ball.vx *= Math.exp(-dt * 2); game.ball.vz *= Math.exp(-dt * 2);
      const collector = players.filter(p => p.role === 'ball-person').sort((a,b) => Math.hypot(a.x-game.ball.x,a.z-game.ball.z)-Math.hypot(b.x-game.ball.x,b.z-game.ball.z))[0];
      for (const p of collector ? [collector] : []) {
        p.tx = clamp(game.ball.x, c.x - COURT.doubles-1, c.x + COURT.doubles+1); p.tz = Math.abs(game.ball.z-c.z)<.9&&Math.abs(game.ball.x-c.x)<COURT.netClear?c.z+(p.z>=c.z?1:-1)*.95:clamp(game.ball.z, c.z - BASE-1.3, c.z + BASE+1.3);
        if (Math.hypot(p.x - p.tx, p.z - p.tz) < .3) { p.pose = 'pickup'; p.strikeUntil = now + .6; game.ball.hidden = true; }
      }
      if (now >= game.next) reset(game, now);
      return;
    }
    if (game.phase !== 'flight') return;
    const b = game.ball, old = { x: b.x, z: b.z, y: b.y };
    const bounced = advanceBall(b, dt);
    if (old.z > c.z && b.z <= c.z || old.z < c.z && b.z >= c.z) {
      const k = (c.z - old.z) / (b.z - old.z), y = old.y + (b.y - old.y) * k, x = old.x+(b.x-old.x)*k;
      const height=netHeight(x-c.x,m.mode);
      if(m.mode!=='doubles'&&Math.abs(x-c.x)>=COURT.singlesStick&&Math.abs(x-c.x)<=COURT.netPost+.06&&y<=COURT.netTop+COURT.ballRadius){b.x=x;b.z=c.z;end(game,b.serve?'fault':'out',now,random);return;}
      if(Math.abs(x-c.x)<COURT.netPost && y<=height+COURT.ballRadius) {
        if(y<height-COURT.ballRadius) { b.x=x;b.z=c.z-Math.sign(b.vz)*.025;b.y=Math.max(.035,y);b.vx*=.3;b.vz*=-.15;b.vy=Math.min(0,b.vy);end(game,b.serve?'fault':'net',now,random);return; }
        b.netTouch=true;b.vx*=.88;b.vz*=.88;b.vy*=.65;game.planned=false;game.intercept=null;game.receiver=null;
        const umpire=players.find(p=>p.role==='umpire');
        if(b.serve&&umpire){umpire.pose='net-call';umpire.call='Net';umpire.strikeUntil=now+1.3;}
      }
    }
    const receiving = 1 - b.team, onReceiverSide = (b.z - c.z) * (south(m, receiving) ? 1 : -1) > .1;
    if (bounced) {
      if (b.bounces === 1) {
        const inside = Math.abs(bounced.x - c.x) <= HALF[m.mode]+COURT.ballRadius && Math.abs(bounced.z - c.z) <= BASE+COURT.ballRadius && onReceiverSide;
        const serviceSide = Math.sign(game.target?.x - c.x);
        const legalServe = !b.serve || Math.abs(bounced.z - c.z) <= SERVICE+COURT.ballRadius && Math.abs(bounced.x - c.x) <= COURT.singles+COURT.ballRadius && (bounced.x-c.x)*serviceSide>=-COURT.ballRadius;
        if (!inside || !legalServe) { end(game, b.serve ? 'fault' : 'out', now, random); return; }
        if(b.serve&&b.netTouch){end(game,'let',now,random);return;}
      }
      if (b.bounces >= 2) { end(game, m.mode === 'training' && b.team === 0 ? 'training return' : 'missed', now, random); return; }
    }
    if (m.mode === 'training' && b.team === 0) {
      if (Math.abs(b.z - c.z) > BASE+COURT.runback || Math.abs(b.x - c.x) > COURT.doubles+COURT.siderun) end(game, 'training return', now, random);
      return; // the stationary machine never receives or returns a ball
    }
    if (!game.planned) planReturn(game, now);
    const p = game.players[game.receiver];
    // Floating-point drift must not postpone contact by another physics step.
    if (p && now + 1e-6 >= game.intercept.at) {
      const at = contact({ ...p, face: game.intercept.face, backhand: game.intercept.backhand, pose: game.intercept.backhand ? 'backhand' : 'forehand' }, b.y);
      if (onReceiverSide && (!b.serve || b.bounces > 0) && b.y > .12 && b.y < 1.5 && Math.hypot(at.x - b.x, at.z - b.z) < .16) strike(game, p, now, random);
    }
    if (Math.abs(b.z - c.z) > BASE+COURT.runback || Math.abs(b.x - c.x) > COURT.doubles+COURT.siderun) end(game, 'out', now, random);
  }

  function freeSeat(person, random) {
    const taken = new Set([...social.values()].filter(p => p.id !== person.id).map(p => p.seat));
    const options = seats.filter(s => !taken.has(s.key) && s.key !== person.lastSeat);
    if (person.nap) return options.find(s => s.type === 'lounge') ?? options[0];
    const types=['chair','bench','lounge'].filter(t=>options.some(s=>s.type===t));
    types.sort((a,b)=>[...social.values()].filter(p=>p.seat&&p.seatType===a).length-[...social.values()].filter(p=>p.seat&&p.seatType===b).length);
    const preferred=types.filter(t=>[...social.values()].filter(p=>p.seat&&p.seatType===t).length===[...social.values()].filter(p=>p.seat&&p.seatType===types[0]).length);
    const pool=options.filter(s=>s.type===preferred[Math.floor(random()*preferred.length)]);
    return pool.length ? pool[Math.floor(random()*pool.length)] : null;
  }
  function leaveSeat(p,force=false) {
    const seat=seats.find(s=>s.key===p.seat);
    if(p.arrived&&seat){
      const occupied=[...social.values()].some(q=>q.id!==p.id&&!q.arrived&&Math.hypot(seat.access[0]-q.x,seat.access[1]-q.z)<.8);
      if(occupied&&!force)return false;
      p.x=seat.access[0];p.z=seat.access[1];
    }
    p.arrived=false;p.seat=null;p.buddy=null;p.way=null;p.pose='stand';p.drinkPhase='hand';
    return true;
  }
  function sit(p, seat, now, random) {
    p.way=null;p.arrived=false;
    if(!seat){p.action='stroll';let at;for(let i=0;i<50;i++){at=[26+random()*22,10.4+random()*5];if(!REC_BLOCKS.some(r=>inside(at,r)))break;}p.tx=at[0];p.tz=at[1];p.next=now+15;return;}
    p.seat=seat.key;p.lastSeat=seat.key;p.table=seat.table;p.action='seat';p.tx=seat.access[0];p.tz=seat.access[1];p.face=seat.face;p.seatType=seat.type;
    p.rest=Math.floor(random()*3);p.poseNext=now+15+random()*15;p.dwell=55+random()*65;p.next=now+180;p.drinkPhase='hand';
  }
  function glassPhase(p,phase,now,duration){p.drinkPhase=phase;p.phaseAt=now;p.phaseEnd=now+duration;}
  function updateSocial(ctx,dt) {
    const idle=guestsOf(ctx.scene).slice(0,10),ids=new Set(idle.map(a=>a.id));
    for(const id of social.keys())if(!ids.has(id))social.delete(id);
    const canServe=idle.filter(a=>!a.nap&&!social.get(a.id)?.drink),bartender=[...social.values()].find(p=>p.action==='bartender'&&p.next>ctx.time);
    const chosen=bartender?.id??canServe[Math.floor(ctx.time/120)%Math.max(1,canServe.length)]?.id;
    for(const a of idle){
      let p=social.get(a.id);const body=ctx.body(a.id);if(!body)continue;
      if(!p){p={...player(a.id,{x:clamp(body.x,19.4,49.4),z:clamp(body.z,4,19.8),role:'guest'}),action:'choose',next:ctx.time,drink:false,seat:null,buddy:null};social.set(a.id,p);}
      p.nap=Boolean(a.nap);
      if(p.action==='bartender'&&ctx.time>=p.next){p.action='choose';p.next=ctx.time;}
      if(p.nap&&p.action!=='seat'){p.action='choose';p.next=ctx.time;}
      if(p.nap&&p.action==='seat')p.next=Math.max(p.next,ctx.time+60);
      if(a.id===chosen&&!p.nap&&!p.drink&&p.action!=='bartender'){if(leaveSeat(p)){p.action='bartender';p.tx=BAR[0];p.tz=BAR[1];p.next=ctx.time+90+ctx.random()*60;}}
      else if(ctx.time>=p.next&&p.action!=='bartender'&&(!p.nap||p.action==='choose')){
        if(p.arrived&&p.drink&&p.drinkPhase==='table'){p.depart=true;glassPhase(p,'reach',ctx.time,.8);p.next=Infinity;}
        else if(!p.arrived||!p.drink){if(leaveSeat(p)){if(!p.nap&&!p.drink&&chosen&&ctx.random()<.7){p.action='buy';p.tx=COUNTER[0]+((hash(p.id)%3)-1)*1.4;p.tz=COUNTER[1];p.next=ctx.time+90;}else sit(p,freeSeat(p,ctx.random),ctx.time,ctx.random);}else p.next=ctx.time+1;}
      }
      move(p,dt,ctx.time,[],[...social.values()]);
      p.kiosk=inside([p.x,p.z],KIOSK);
      if(!p.moving&&Math.hypot(p.x-p.tx,p.z-p.tz)<.05){
        const server=social.get(chosen);
        if((p.action==='buy'||p.action==='return')&&server?.action==='bartender'&&!server.moving&&ctx.time>=(server.servingUntil??0)){
          server.servingUntil=ctx.time+1.8;server.pose=p.action==='buy'?'pour':'receive';server.strikeUntil=server.servingUntil;
          if(p.action==='buy'){p.drink=true;p.drinkLevel=4;p.action='receive';glassPhase(p,'receive',ctx.time,.8);}
          else{p.action='give';glassPhase(p,'give',ctx.time,.8);}
          p.pose='hold';p.face='north';p.next=Infinity;
        }else if(p.action==='receive'&&ctx.time>=p.phaseEnd){sit(p,freeSeat(p,ctx.random),ctx.time,ctx.random);}
        else if(p.action==='give'&&ctx.time>=p.phaseEnd){p.drink=false;p.drinkLevel=0;sit(p,freeSeat(p,ctx.random),ctx.time,ctx.random);}
        else if(p.action==='seat'){
          const seat=seats.find(s=>s.key===p.seat);
          if(!p.arrived){p.x=p.tx=seat.x;p.z=p.tz=seat.z;p.arrived=true;p.next=ctx.time+p.dwell;p.poseNext=ctx.time+10+ctx.random()*18;p.drinkPhase='table';}
          p.face=seat.face;p.buddy=null;
          if(p.drink&&!p.nap&&ctx.time>=p.poseNext&&p.drinkPhase==='table'){glassPhase(p,'reach',ctx.time,.8);p.poseNext=ctx.time+18+ctx.random()*16;}
          if(p.drink&&ctx.time>=p.phaseEnd){
            if(p.drinkPhase==='reach'){
              if(p.depart){if(leaveSeat(p)){p.depart=false;sit(p,freeSeat(p,ctx.random),ctx.time,ctx.random);}else p.phaseEnd=ctx.time+1;}
              else glassPhase(p,'sip',ctx.time,3.5);
            }else if(p.drinkPhase==='sip'){p.drinkLevel=Math.max(0,p.drinkLevel-1);glassPhase(p,'setdown',ctx.time,.8);}
            else if(p.drinkPhase==='setdown'){
              p.drinkPhase='table';
              if(p.drinkLevel===0){if(leaveSeat(p)){p.action='return';p.tx=COUNTER[0]+((hash(p.id)%3)-1)*1.4;p.tz=COUNTER[1];p.next=Infinity;}else{p.drinkPhase='setdown';p.phaseEnd=ctx.time+1;}}
            }
          }
          if(!p.drink&&ctx.time>=p.poseNext){p.rest=(p.rest+1+Math.floor(ctx.random()*2))%3;p.poseNext=ctx.time+18+ctx.random()*16;}
          if(p.arrived){p.pose=seat.type==='lounge'?'lie':'sit';if(['reach','setdown'].includes(p.drinkPhase))p.pose=seat.type==='lounge'?'lie-hold':'hold';if(p.drinkPhase==='sip')p.pose=seat.type==='lounge'?'lie-sip':'sip';
            if(!p.nap&&seat.type!=='lounge'&&p.drinkPhase==='table'){const peer=[...social.values()].find(q=>q.id!==p.id&&q.arrived&&q.table===p.table&&!q.nap);if(peer){p.buddy=peer.id;p.face=direction(peer.x-p.x,peer.z-p.z);if((Math.floor(ctx.time/5)+hash([p.id,peer.id].sort().join(':')))%2===Number(p.id>peer.id))p.pose='chat';}}
          }
        }else if(p.action==='bartender'&&ctx.time>=p.strikeUntil){p.pose='stand';p.face='south';}
      }
      p.glassMode=p.arrived&&p.seatType==='lounge'&&seats.find(s=>s.key===p.seat)?.tableAt?p.drinkPhase==='table'?'table':p.drinkPhase==='reach'?'reach':p.drinkPhase==='setdown'?'setdown':'hand':p.action==='receive'?'receive':p.action==='give'?'give':'hand';
      p.glassT=['reach','setdown','receive','give'].includes(p.glassMode)?clamp((ctx.time-p.phaseAt)/(p.phaseEnd-p.phaseAt),0,1):1;
      Object.assign(body,{x:p.x,z:p.z,tx:p.x,tz:p.z,path:[],walk:p.moving,zone:'idle'});
    }
  }
  function pack(p) { return { x: round(p.x), z: round(p.z), face: p.face, pose: p.pose, role: p.role, ...(p.gaze===undefined?{}:{gaze:p.gaze}),...(p.call?{call:p.call}:{}),...(p.rest===undefined?{}:{rest:p.rest}),...(p.seatType?{seatType:p.seatType}:{}), ...(p.stance ? { stance: true } : {}), ...(p.backhand ? { backhand: true } : {}), ...(p.team === undefined ? {} : { team: p.team }), ...(p.moving ? { moving: true } : {}), ...(p.role==='guest'?{action:p.action,arrived:Boolean(p.arrived),kiosk:Boolean(p.kiosk)}:{}),...(p.drink?{drink:true,drinkLevel:p.drinkLevel??4,glassMode:p.glassMode??'hand',glassT:Math.round((p.glassT??1)*16)/16,seat:p.seat??null}:{}), ...(p.buddy ? { buddy: p.buddy } : {}) }; }
  function sharedOf() {
    const out = { social0: {}, social1: {}, social2: {}, social3: {}, courts0: {}, courts1: {}, courts2: {}, courts3: {}, courts4: {}, courts5: {} };
    let i = 0;
    for (const [id, p] of social) { if (i >= 128) break; out[`social${Math.floor(i++ / 32)}`][id] = pack(p); }
    for (const game of courts.values()) out[`courts${Math.floor(game.court.bed / 3)}`][game.court.bed] = {
      phase: game.phase, call: game.call ?? '', ...(game.phase === 'impact' ? { hitter: game.shot.player } : {}), players: Object.fromEntries(Object.entries(game.players).map(([id, p]) => [id, pack(p)])),
      ball: game.ball ? { x: round(game.ball.x), z: round(game.ball.z), y: round(Math.max(0, game.ball.y)), hidden: Boolean(game.ball.hidden), kind: game.ball.kind, team: game.ball.team, bounces: game.ball.bounces } : null,
      loose: game.loose.map(p => ({ x: round(p.x), z: round(p.z) })), mode: game.match.mode, active: game.match.active, machine: { x: game.court.x, z: game.court.z - COURT.feeder },
    };
    return out;
  }
  function readShared(shared) { return { social: Object.assign({}, ...[0, 1, 2, 3].map(i => shared?.[`social${i}`])), courts: Object.assign({}, ...[0, 1, 2, 3, 4, 5].map(i => shared?.[`courts${i}`])) }; }
  A.tennisView = { COURT, netHeight, distance, matchesOf, positions, direction, hash, seats, BAR, DESK, readShared, launch, stepCourt, player, racketOffset, racketFlip, PLAYER_SIZE, PLAYER_ANCHOR, BALL_LIFT, guestsOf, advanceBall, aroundNets, furnitureRoute, REC_BLOCKS, KIOSK, crosses, inside, seats };
  A.sim({
    place(ctx, a) {
      const m = matchesOf(ctx.scene)[a.repo], court = ctx.plotOf(a.repo);
      if (m && court && a.state === 'working' && m.parent === a.id) {
        const game=courts.get(a.repo),body=ctx.body(a.id),p=game?.players[a.id]??positions(m,court)[a.id],zone=`tennis:${court.bed}`;
        return {at:body?.zone===zone&&body.path.length?[body.tx,body.tz]:[p.x,p.z],zone};
      }
      if (a.state === 'waiting' || a.state === 'turn' && !a.nap) return 'wait';
      if (a.state === 'working' && !a.nap) return 'wait';
      if (!guestsOf(ctx.scene).slice(0,10).some(p => p.id === a.id)) return null;
      const seated = social.get(a.id);
      return seated ? { at: [seated.x, seated.z], zone: 'idle' } : 'idle';
    },
    scene(ctx, scene) {
      if (!routed) {
        const route = ctx.layout.route, barriers = ctx.world.plots.at.map(([x,z]) => ({x,z}));
        ctx.layout.route = (from,to) => {const out=[];let at=from;for(const end of aroundNets(from,route(from,to),barriers)){const way=furnitureRoute(at,end,null,false);out.push(...way);at=end;}return out;}; routed = true;
      }
      const matches = matchesOf(scene), live = new Set(), agents = new Map([...scene.agents, ...(scene.subagents ?? [])].map(a => [a.id, a]));
      for (const [repo, m] of Object.entries(matches)) {
        const court = ctx.plotOf(repo); if (!court) continue; live.add(repo);
        const roster = JSON.stringify([m.teams, m.helpers]); let game = courts.get(repo);
        const changedEndsOrServer = game && (game.match.score.ends !== m.score.ends || game.match.score.server !== m.score.server);
        if (!game || game.roster !== roster || game.court.bed!==court.bed || game.court.x!==court.x || game.court.z!==court.z) {
          const initial = positions(m, court);
          game = { court, match: m, roster, players: Object.fromEntries(Object.entries(initial).filter(([id]) => id !== '@machine').map(([id, at]) => [id, player(id, at)])), ball: null, loose: [], collectAfter: ctx.time + 120 + ctx.random() * 30, phase: 'prepare', next: ctx.time + 1, secondServe: false, entering: false };
          reset(game, ctx.time); courts.set(repo, game);
        }
        game.match = m;
        if (changedEndsOrServer) reset(game, ctx.time);
        for (const p of Object.values(game.players)) p.step = agents.get(p.id)?.step ?? agents.get(m.parent)?.step ?? 'other';
      }
      for (const repo of courts.keys()) if (!live.has(repo)) courts.delete(repo);
      const guests = guestsOf(scene).slice(0,10), visible = new Set(guests.map(a => a.id));
      for(const [id,p]of social)if(!visible.has(id)){const body=ctx.body(id);leaveSeat(p,true);if(body)Object.assign(body,{x:p.x,z:p.z,tx:p.x,tz:p.z,path:[]});social.delete(id);}
      {
        const server = guests.find(a=>social.get(a.id)?.action==='bartender')??guests.filter(a => !a.nap).sort((a, b) => hash(a.id) - hash(b.id))[0];
        const customer=social.size?null:guests.find(a=>!a.nap&&a.id!==server?.id&&!social.has(a.id));
        for (const a of guests) {
          if(social.has(a.id))continue;
          const p = { ...player(a.id, { x: 27, z: 11, role: 'guest' }), next: ctx.time + 10, drink: false, seat: null, buddy: null, nap: Boolean(a.nap) };
          social.set(a.id, p);
          if (a.id === server?.id) { p.x = p.tx = BAR[0]; p.z = p.tz = BAR[1]; p.action = 'bartender'; p.next = ctx.time + 100 + ctx.random()*40; p.pose = 'stand'; }
          else if(a.id===customer?.id){p.x=p.tx=COUNTER[0]+((hash(p.id)%3)-1)*1.4;p.z=p.tz=COUNTER[1];p.action='buy';p.next=ctx.time+90;p.pose='stand';p.face='north';}
          else { sit(p, freeSeat(p, ctx.random), ctx.time, ctx.random); const seat=seats.find(s=>s.key===p.seat);p.x=p.tx=seat.x;p.z=p.tz=seat.z;p.arrived=true;p.drinkPhase='table'; p.pose = p.seatType === 'lounge' ? 'lie' : 'sit'; if(!p.nap){p.next=ctx.time+12+hash(p.id)%65;if(hash(p.id)%3===0){p.drink=true;p.drinkLevel=1+hash(p.id)%4;}} }
        }
      }
    },
    tick(ctx, dt) {
      updateSocial(ctx, dt);
      for (const game of courts.values()) {
        const body = ctx.body(game.match.parent), p = game.players[game.match.parent];
        if (!body || !p || !body.zone.startsWith('tennis:')) continue;
        game.entering = body.path.length > 0;
        if (game.entering) { p.x = body.x; p.z = body.z; p.pose = 'walk'; p.moving = true;p.stance=false; }
        for (let left = dt; left > 0; left -= .025) stepCourt(game, Math.min(.025, left), ctx.time - Math.max(0, left - .025), ctx.random);
        if (!game.entering && game.match.active) Object.assign(body, { x: p.x, z: p.z, tx: p.x, tz: p.z, path: [], walk: p.moving });
      }
    },
    share: sharedOf,
  });
})();

(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LuaCode = factory();
  }
})(typeof self !== "undefined" ? self : this, function() {

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function luaEscapeString(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toLuaValue(value) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "string") return "'" + luaEscapeString(value) + "'";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "{" + value.map(toLuaValue).join(",") + "}";
  if (isPlainObject(value)) {
    const entries = Object.keys(value).map(function(key) {
      return key + "=" + toLuaValue(value[key]);
    });
    return "{" + entries.join(",") + "}";
  }
  return "nil";
}

function range(start, end, step) {
  step = step || 1;
  const out = [];
  if (step > 0) {
    for (let i = start; i <= end; i += step) out.push(i);
  } else {
    for (let i = start; i >= end; i += step) out.push(i);
  }
  return out;
}

function indicesList(start, end, step) {
  return range(start, end, step).join(",");
}

function luaIdentifier(name) {
  return String(name).replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}

class LuaWriter {
  constructor() {
    this.lines = [];
  }

  raw(line) {
    this.lines.push(line);
    return this;
  }

  blank() {
    this.lines.push("");
    return this;
  }

  local(name, value) {
    this.lines.push("local " + name + " = " + toLuaValue(value));
    return this;
  }

  localMulti(pairs) {
    const names = pairs.map(function(p) { return p[0]; }).join(",");
    const values = pairs.map(function(p) { return toLuaValue(p[1]); }).join(",");
    this.lines.push("local " + names + "=" + values);
    return this;
  }

  assign(target, value) {
    this.lines.push(target + " = " + toLuaValue(value));
    return this;
  }

  call(fnName, args) {
    const argStr = (args || []).map(function(a) {
      return typeof a === "string" && a.indexOf("__raw:") === 0 ? a.slice(6) : toLuaValue(a);
    }).join(",");
    this.lines.push(fnName + "(" + argStr + ")");
    return this;
  }

  fn(name, params, bodyFn) {
    this.lines.push("function " + name + "(" + (params || []).join(",") + ")");
    bodyFn(this);
    this.lines.push("end");
    return this;
  }

  ifBlock(condition, thenFn, elseFn) {
    this.lines.push("if " + condition + " then");
    thenFn(this);
    if (elseFn) {
      this.lines.push("else");
      elseFn(this);
    }
    this.lines.push("end");
    return this;
  }

  forNum(varName, from, to, bodyFn, step) {
    this.lines.push("for " + varName + "=" + from + "," + to + (step ? "," + step : "") + " do");
    bodyFn(this);
    this.lines.push("end");
    return this;
  }

  forIn(varName, tableExpr, bodyFn) {
    this.lines.push("for _, " + varName + " in ipairs(" + tableExpr + ") do");
    bodyFn(this);
    this.lines.push("end");
    return this;
  }

  forPairs(keyName, valName, tableExpr, bodyFn) {
    this.lines.push("for " + keyName + ", " + valName + " in pairs(" + tableExpr + ") do");
    bodyFn(this);
    this.lines.push("end");
    return this;
  }

  whileLoop(condition, bodyFn) {
    this.lines.push("while " + condition + " do");
    bodyFn(this);
    this.lines.push("end");
    return this;
  }

  repeatUntil(bodyFn, condition) {
    this.lines.push("repeat");
    bodyFn(this);
    this.lines.push("until " + condition);
    return this;
  }

  merge(otherWriter) {
    this.lines = this.lines.concat(otherWriter.lines);
    return this;
  }

  build() {
    return this.lines.join("\n");
  }
}

function generateHoldCoverScript(config) {
  config = config || {};
  const isPixelDefault = config.isPixelDefault || false;
  const pixelColors = config.pixelColors || ["purple", "blue", "green", "orange", "purple", "blue", "green", "orange"];
  const normalColors = config.normalColors || ["Purple", "Blue", "Green", "Red", "Purple", "Blue", "Green", "Red"];
  const pixelSpritesheet = config.pixelSpritesheet || "noteHolding/pixelNoteSplash";
  const normalSpritesheet = config.normalSpritesheet || "noteHolding/holdCover";
  const pixelOffsets = config.pixelOffsets || { px: -20, py: 0, ox: -20, oy: 0 };
  const normalOffsets = config.normalOffsets || { px: -100, py: -100, ox: -100, oy: -100 };
  const endDelay = config.endDelay || 10;
  const disappearDelay = config.disappearDelay || 0.3;
  const dadHoldSustains = config.dadHoldSustains !== false;
  const pixelScale = config.pixelScale || { x: 4, y: 4 };
  const normalScale = config.normalScale || { x: 1, y: 1 };

  const w = new LuaWriter();

  w.local("holdGroup", []);
  w.local("isPixel", isPixelDefault);
  w.blank();

  w.raw("local pixelConfig = " + toLuaValue({
    colors: pixelColors,
    spritesheet: pixelSpritesheet,
    scale: pixelScale,
    antialiasing: false,
    offsets: pixelOffsets
  }));
  w.blank();

  w.raw("local normalConfig = " + toLuaValue({
    colors: normalColors,
    spritesheet: normalSpritesheet,
    scale: normalScale,
    antialiasing: true,
    offsets: normalOffsets
  }));
  w.blank();

  w.raw("local sustainData = " + toLuaValue({
    alpha: 1,
    xPos: 0,
    yPos: { upscroll: 0, downscroll: 0 },
    holdDurations: [0, 0, 0, 0, 0, 0, 0, 0],
    endDelay: endDelay,
    timeTillDisappear: disappearDelay,
    dadHoldSustains: dadHoldSustains,
    offsets: {}
  }));
  w.blank();

  w.fn("onCreatePost", [], function(b) {
    b.raw("isPixel = getPropertyFromClass('states.PlayState', 'isPixelStage')");
    b.raw("local cfg = isPixel and pixelConfig or normalConfig");
    b.blank();
    b.forNum("i", 1, 4, function(inner) {
      inner.raw("sustainData.offsets[i] = {x=cfg.offsets.px, y=cfg.offsets.py}");
    });
    b.forNum("i", 5, 8, function(inner) {
      inner.raw("sustainData.offsets[i] = {x=cfg.offsets.ox, y=cfg.offsets.oy}");
    });
    b.blank();
    b.forNum("i", 1, 8, function(inner) {
      inner.raw("local tag = 'holdSplash'..i");
      inner.raw("local color = cfg.colors[i]");
      inner.blank();
      inner.ifBlock("isPixel", function(t) {
        t.raw("makeAnimatedLuaSprite(tag, cfg.spritesheet, 0, 0)");
        t.blank();
        t.raw("addAnimationByPrefix(tag,'holdStart',color..'100',24,false)");
        t.raw("addAnimationByPrefix(tag,'holding',color..'200',24,true)");
        t.raw("addAnimationByPrefix(tag,'holdEnd',color..'300',24,false)");
      }, function(e) {
        e.raw("local path = cfg.spritesheet..color");
        e.raw("makeAnimatedLuaSprite(tag, path, 0, 0)");
        e.blank();
        e.raw("addAnimationByPrefix(tag,'holdStart','holdCoverStart'..color,24,false)");
        e.raw("addAnimationByPrefix(tag,'holding','holdCover'..color,24,true)");
        e.raw("addAnimationByPrefix(tag,'holdEnd','holdCoverEnd'..color,24,false)");
      });
      inner.blank();
      inner.raw("setObjectCamera(tag,'hud')");
      inner.raw("setProperty(tag..'.visible',false)");
      inner.blank();
      inner.raw("scaleObject(tag,cfg.scale.x,cfg.scale.y)");
      inner.raw("setProperty(tag..'.antialiasing',cfg.antialiasing)");
      inner.raw("setProperty(tag..'.alpha',sustainData.alpha)");
      inner.blank();
      inner.raw("addLuaSprite(tag,true)");
      inner.raw("table.insert(holdGroup,tag)");
    });
  });
  w.blank();

  w.fn("onUpdate", ["elapsed"], function(b) {
    b.raw("updateHoldSplashPos()");
  });
  w.blank();

  w.fn("updateHoldSplashPos", [], function(b) {
    b.forNum("i", 1, 4, function(inner) {
      inner.raw("local sx=getPropertyFromGroup('playerStrums',i-1,'x')+sustainData.offsets[i].x");
      inner.raw("local sy=getPropertyFromGroup('playerStrums',i-1,'y')+sustainData.offsets[i].y");
      inner.blank();
      inner.raw("setProperty(holdGroup[i]..'.x',sx+sustainData.xPos)");
      inner.raw("setProperty(holdGroup[i]..'.y',");
      inner.raw("downscroll and sy+sustainData.yPos.downscroll or sy+sustainData.yPos.upscroll)");
    });
    b.blank();
    b.forNum("i", 5, 8, function(inner) {
      inner.raw("local idx=i-5");
      inner.raw("local sx=getPropertyFromGroup('opponentStrums',idx,'x')+sustainData.offsets[i].x");
      inner.raw("local sy=getPropertyFromGroup('opponentStrums',idx,'y')+sustainData.offsets[i].y");
      inner.blank();
      inner.raw("setProperty(holdGroup[i]..'.x',sx+sustainData.xPos)");
      inner.raw("setProperty(holdGroup[i]..'.y',");
      inner.raw("downscroll and sy+sustainData.yPos.downscroll or sy+sustainData.yPos.upscroll)");
    });
    b.blank();
    b.raw("for i=1,#sustainData.holdDurations do");
    b.raw("sustainData.holdDurations[i]=sustainData.holdDurations[i]+1");
    b.blank();
    b.raw("if sustainData.holdDurations[i]==sustainData.endDelay then");
    b.raw("objectPlayAnimation(holdGroup[i],'holdEnd',false)");
    b.raw("runTimer('hideHold'..i,sustainData.timeTillDisappear)");
    b.raw("end");
    b.raw("end");
  });
  w.blank();

  w.fn("onTimerCompleted", ["t"], function(b) {
    b.forNum("i", 1, 8, function(inner) {
      inner.ifBlock("t=='hideHold'..i", function(t) {
        t.raw("setProperty(holdGroup[i]..'.visible',false)");
      });
    });
  });
  w.blank();

  w.fn("goodNoteHit", ["id", "dir", "noteType", "isSustain"], function(b) {
    b.ifBlock("getPropertyFromClass('states.PlayState', 'isPixelStage')", function(t) {
      t.ifBlock("not isSustain", function(t2) {
        t2.raw("sustainHolding(dir+1)");
      });
    }, function(e) {
      e.ifBlock("isSustain", function(t2) {
        t2.raw("sustainHolding(dir+1)");
      });
    });
  });
  w.blank();

  w.fn("opponentNoteHit", ["id", "dir", "noteType", "isSustain"], function(b) {
    b.ifBlock("not getPropertyFromClass('states.PlayState', 'isPixelStage')", function(t) {
      t.ifBlock("isSustain and sustainData.dadHoldSustains", function(t2) {
        t2.raw("sustainHolding(dir+5)");
      });
    });
  });
  w.blank();

  w.fn("sustainHolding", ["i"], function(b) {
    b.raw("setProperty(holdGroup[i]..'.visible',true)");
    b.raw("objectPlayAnimation(holdGroup[i],'holding',true)");
    b.raw("sustainData.holdDurations[i]=0");
  });

  return w.build();
}

function generateCharacterGroupScript(config) {
  config = config || {};
  const groups = config.groups || {};
  const scripts = config.scripts || {};
  const picoEnabled = config.picoEnabled !== false;

  const w = new LuaWriter();

  w.local("pico", picoEnabled);
  w.blank();

  const groupKeys = Object.keys(groups);
  w.raw("local charGroups = {");
  groupKeys.forEach(function(key, index) {
    const suffix = index < groupKeys.length - 1 ? "," : "}";
    w.raw(key + " = " + toLuaValue(groups[key]) + suffix);
  });
  w.blank();

  w.fn("isInGroup", ["c", "g"], function(b) {
    b.forIn("name", "g", function(inner) {
      inner.ifBlock("c == name", function(t) {
        t.raw("return true");
      });
    });
    b.raw("return false");
  });
  w.blank();

  w.fn("onCreatePost", [], function(b) {
    b.raw("local isStory = isStoryMode");
    b.raw("local isLastSong = getPropertyFromClass('states.PlayState', 'storyPlaylist.length') <= 1");
    b.blank();
    b.ifBlock("not isStory or (isStory and isLastSong)", function(t) {
      groupKeys.forEach(function(key) {
        const scriptPath = scripts[key];
        if (!scriptPath) return;
        t.ifBlock("isInGroup(boyfriendName, charGroups." + key + ")", function(inner) {
          inner.raw("addLuaScript('" + scriptPath + "')");
        });
        t.blank();
      });
    });
  });

  return w.build();
}

function generateNoteSplashScript(config) {
  config = config || {};
  const spritesheet = config.spritesheet || "NOTE_hold_assets";
  const colors = config.colors || ["purple", "blue", "green", "red"];
  const useRatingColors = config.useRatingColors !== false;
  const disableDefault = config.disableDefault !== false;
  const scale = config.scale || { x: 1, y: 1 };
  const antialiasing = config.antialiasing !== false;
  const poolSize = config.poolSize || 8;

  const w = new LuaWriter();

  w.local("splashPool", []);
  w.local("poolSize", poolSize);
  w.blank();

  if (disableDefault) {
    w.fn("onCreate", [], function(b) {
      b.raw("setPropertyFromClass('states.PlayState', 'splashSkin', 'none')");
    });
    w.blank();
  }

  w.fn("onCreatePost", [], function(b) {
    b.forNum("i", 1, "poolSize", function(inner) {
      inner.raw("local tag = 'customSplash'..i");
      inner.raw("makeAnimatedLuaSprite(tag, " + toLuaValue(spritesheet) + ", 0, 0)");
      colors.forEach(function(color) {
        inner.raw("addAnimationByPrefix(tag,'splash" + color + "','note splash " + color + "',24,false)");
      });
      inner.raw("setObjectCamera(tag,'hud')");
      inner.raw("setProperty(tag..'.visible',false)");
      inner.raw("scaleObject(tag," + scale.x + "," + scale.y + ")");
      inner.raw("setProperty(tag..'.antialiasing'," + antialiasing + ")");
      inner.raw("addLuaSprite(tag,true)");
      inner.raw("table.insert(splashPool,tag)");
      inner.blank();
    });
  });
  w.blank();

  w.fn("goodNoteHit", ["id", "dir", "noteType", "isSustain"], function(b) {
    b.ifBlock("not isSustain", function(t) {
      const ratingExpr = useRatingColors ? "getPropertyFromGroup('notes', id, 'rating')" : toLuaValue(colors[0]);
      t.raw("local rating = " + ratingExpr);
      t.raw("spawnSplash(dir, rating)");
    });
  });
  w.blank();

  w.fn("spawnSplash", ["dir", "colorKey"], function(b) {
    b.raw("local tag = splashPool[(dir % poolSize) + 1]");
    b.raw("local sx = getPropertyFromGroup('playerStrums', dir, 'x')");
    b.raw("local sy = getPropertyFromGroup('playerStrums', dir, 'y')");
    b.raw("setProperty(tag..'.x', sx)");
    b.raw("setProperty(tag..'.y', sy)");
    b.raw("setProperty(tag..'.visible', true)");
    b.raw("objectPlayAnimation(tag, 'splash'..colorKey, true)");
  });

  return w.build();
}

function generateScoreTallySystem(config) {
  config = config || {};
  const categories = config.categories || [
    { name: "sickTxt", digits: 4, x: 220, y: 280, spacing: 40, color: "88E49F" },
    { name: "goodTxt", digits: 4, x: 200, y: 330, spacing: 40, color: "8AC9E7" },
    { name: "badTxt", digits: 4, x: 180, y: 380, spacing: 40, color: "E2D08B" },
    { name: "shitTxt", digits: 4, x: 200, y: 430, spacing: 40, color: "E28E8C" },
    { name: "missTxt", digits: 4, x: 240, y: 480, spacing: 40, color: "C989E9" }
  ];
  const spritesheet = config.spritesheet || "resultScreen/tallieNumber";

  const w = new LuaWriter();

  w.local("tallieCache", {});
  w.blank();

  w.fn("initTallie", ["t", "maxDigits", "x", "y", "spa", "color"], function(b) {
    b.raw("tallieCache[t] = {digits = {}, max = maxDigits}");
    b.forNum("i", 1, "maxDigits", function(inner) {
      inner.raw("local tag = t..i");
      inner.raw("makeAnimatedLuaSprite(tag, " + toLuaValue(spritesheet) + ", x + spa * (i - 1), y)");
      inner.raw("setObjectCamera(tag, 'other')");
      inner.raw("setProperty(tag..'.color', getColorFromHex(color))");
      inner.raw("addLuaSprite(tag)");
      inner.raw("setProperty(tag..'.visible', false)");
      inner.raw("tallieCache[t].digits[i] = tag");
    });
  });
  w.blank();

  w.fn("setTallieText", ["t", "v"], function(b) {
    b.raw("local data = tallieCache[t]");
    b.raw("local letters = stringSplit(tostring(v), '')");
    b.forNum("i", 1, "data.max", function(inner) {
      inner.raw("setProperty(data.digits[i]..'.visible', false)");
    });
    b.raw("for i = 1, #letters do");
    b.raw("local tag = data.digits[i]");
    b.raw("local digit = letters[i]");
    b.raw("addAnimationByPrefix(tag, digit, digit, 0, false)");
    b.raw("objectPlayAnimation(tag, digit, true)");
    b.raw("setProperty(tag..'.visible', true)");
    b.raw("end");
  });
  w.blank();

  w.fn("onCreatePost", [], function(b) {
    categories.forEach(function(cat) {
      b.call("initTallie", [
        "__raw:" + toLuaValue(cat.name),
        "__raw:" + cat.digits,
        "__raw:" + cat.x,
        "__raw:" + cat.y,
        "__raw:" + cat.spacing,
        "__raw:" + toLuaValue(cat.color)
      ]);
    });
  });

  return w.build();
}

class LuaTemplateRegistry {
  constructor() {
    this.templates = {};
    this.meta = {};
    this.register("holdCover", generateHoldCoverScript, {
      label: "Hold Cover / Sustain Splash",
      description: "Note-hold splash system with pixel and normal stage variants."
    });
    this.register("characterGroup", generateCharacterGroupScript, {
      label: "Character Group Script",
      description: "Loads per-character scripts based on group membership (bf/pico style)."
    });
    this.register("noteSplash", generateNoteSplashScript, {
      label: "Note Splash Pool",
      description: "Pooled note-hit splash sprites replacing the default splash."
    });
    this.register("scoreTally", generateScoreTallySystem, {
      label: "Score Tally Digits",
      description: "Animated digit counters for results-screen style tallies."
    });
  }

  register(name, generatorFn, meta) {
    this.templates[name] = generatorFn;
    this.meta[name] = meta || {};
    return this;
  }

  generate(name, config) {
    const fn = this.templates[name];
    if (!fn) throw new Error("Unknown Lua template: " + name);
    return fn(config || {});
  }

  list() {
    const self = this;
    return Object.keys(this.templates).map(function(id) {
      return { id: id, label: self.meta[id].label || id, description: self.meta[id].description || "" };
    });
  }
}

const registry = new LuaTemplateRegistry();

return {
  toLuaValue: toLuaValue,
  luaEscapeString: luaEscapeString,
  luaIdentifier: luaIdentifier,
  range: range,
  indicesList: indicesList,
  LuaWriter: LuaWriter,
  generateHoldCoverScript: generateHoldCoverScript,
  generateCharacterGroupScript: generateCharacterGroupScript,
  generateNoteSplashScript: generateNoteSplashScript,
  generateScoreTallySystem: generateScoreTallySystem,
  LuaTemplateRegistry: LuaTemplateRegistry,
  registry: registry,
  list: function() { return registry.list(); },
  generate: function(name, config) { return registry.generate(name, config); }
};

});

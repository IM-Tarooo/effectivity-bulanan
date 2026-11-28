/*
 * Data layer.
 * - SupabaseStore: dipakai kalau config Supabase terisi.
 * - DemoStore: localStorage, untuk preview tanpa backend.
 *
 * Semua method mengembalikan objek dengan bentuk yang sama supaya app.js
 * tidak peduli backend mana yang dipakai.
 */
(function (global) {
  "use strict";

  var EFB = global.EFB;
  var CFG = global.APP_CONFIG || {};

  var CATEGORIES = ["Makan Pokok", "Jajan", "Masak Kos", "Transport", "Kebutuhan", "Lainnya"];
  var BUDGET_CATEGORY = "Budget";

  function mapEntry(row) {
    return {
      id: row.id,
      householdId: row.household_id,
      createdBy: row.created_by,
      date: row.entry_date,
      type: row.type,
      category: row.category,
      description: row.description,
      amount: Number(row.amount),
      createdAt: row.created_at
    };
  }

  function mapMenu(row) {
    return {
      id: row.id,
      householdId: row.household_id,
      name: row.name,
      category: row.category,
      kind: row.kind,
      defaultAmount: Number(row.default_amount),
      sortOrder: Number(row.sort_order) || 0,
      createdAt: row.created_at
    };
  }

  function mapMember(row) {
    return {
      householdId: row.household_id,
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
      joinedAt: row.joined_at
    };
  }

  function mapHousehold(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      inviteCode: row.invite_code,
      createdAt: row.created_at
    };
  }

  function friendlyDbError(error) {
    if (!error) return new Error("Terjadi kesalahan.");
    return error;
  }

  /* ==========================================================
   * SUPABASE
   * ========================================================== */
  function createSupabaseStore() {
    var client = global.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    var store = {
      mode: "supabase",
      hasBackend: true,
      client: client,
      userId: null,
      householdId: null,

      init: async function () {
        var res = await client.auth.getSession();
        if (res.error) throw res.error;
        if (res.data.session && res.data.session.user) {
          store.userId = res.data.session.user.id;
        }
        return res.data.session;
      },

      onAuthChange: function (cb) {
        return client.auth.onAuthStateChange(function (event, session) {
          setTimeout(function () {
            cb(event, session);
          }, 0);
        });
      },

      signIn: async function (email, password) {
        var res = await client.auth.signInWithPassword({ email: email, password: password });
        if (res.error) throw res.error;
        if (res.data.user) store.userId = res.data.user.id;
        return res.data;
      },

      signUp: async function (email, password, displayName) {
        var res = await client.auth.signUp({
          email: email,
          password: password,
          options: { data: { display_name: displayName || "" } }
        });
        if (res.error) throw res.error;
        if (res.data.user) store.userId = res.data.user.id;
        return { user: res.data.user, session: res.data.session };
      },

      signInWithAccessCode: function (code) {
        return store.signInWithAccess({ code: code });
      },

      signInWithAccessToken: function (token) {
        return store.signInWithAccess({ token: token });
      },

      signInWithAccess: async function (payload) {
        var res = await client.functions.invoke("code-login", { body: payload });
        if (res.error) {
          var message = "Kode akses tidak valid.";
          var rawMessage = String((res.error && res.error.message) || "");
          var status = res.error.context && res.error.context.status;

          if (status === 404) {
            message = "Login kode belum aktif. Coba lagi nanti.";
          } else if (
            (res.error && res.error.name === "FunctionsFetchError") ||
            /failed to send|failed to fetch|network/i.test(rawMessage)
          ) {
            message = "Tidak bisa menghubungi server login. Coba lagi.";
          }

          try {
            if (res.error.context && typeof res.error.context.json === "function") {
              var errorBody = await res.error.context.json();
              if (errorBody && errorBody.error && status !== 404) message = errorBody.error;
            }
          } catch (e) {
            /* ignore response parsing errors */
          }
          throw new Error(message);
        }

        var data = res.data || {};
        if (!data.ok || !data.token_hash) {
          throw new Error(data.error || "Kode akses tidak valid.");
        }

        var verify = await client.auth.verifyOtp({
          token_hash: data.token_hash,
          type: "email"
        });
        if (verify.error) throw verify.error;
        if (verify.data && verify.data.user) store.userId = verify.data.user.id;
        return verify.data;
      },

      signOut: async function () {
        var res = await client.auth.signOut();
        store.userId = null;
        store.householdId = null;
        if (res.error) throw res.error;
      },

      getContext: async function () {
        var userRes = await client.auth.getUser();
        if (userRes.error && !(userRes.data && userRes.data.user)) throw userRes.error;
        var user = userRes.data ? userRes.data.user : null;
        if (!user) return { user: null, membership: null, household: null };

        store.userId = user.id;

        var memberRes = await client
          .from("household_members")
          .select("household_id, display_name, role, joined_at")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();

        if (memberRes.error) throw memberRes.error;
        if (!memberRes.data) return { user: user, membership: null, household: null };

        store.householdId = memberRes.data.household_id;

        var houseRes = await client
          .from("households")
          .select("id, name, invite_code, created_at")
          .eq("id", memberRes.data.household_id)
          .maybeSingle();

        if (houseRes.error) throw houseRes.error;

        return {
          user: user,
          membership: {
            householdId: memberRes.data.household_id,
            userId: user.id,
            displayName: memberRes.data.display_name,
            role: memberRes.data.role,
            joinedAt: memberRes.data.joined_at
          },
          household: mapHousehold(houseRes.data)
        };
      },

      createHousehold: async function (name, displayName) {
        var res = await client.rpc("create_household", {
          p_name: name,
          p_display_name: displayName || null
        });
        if (res.error) throw res.error;
        return res.data;
      },

      joinHousehold: async function (code, displayName) {
        var res = await client.rpc("join_household", {
          p_code: code,
          p_display_name: displayName || null
        });
        if (res.error) throw res.error;
        return res.data;
      },

      leaveHousehold: async function () {
        var res = await client.rpc("leave_household");
        if (res.error) throw res.error;
        store.householdId = null;
      },

      listMembers: async function () {
        var res = await client
          .from("household_members")
          .select("household_id, user_id, display_name, role, joined_at")
          .eq("household_id", store.householdId)
          .order("joined_at", { ascending: true });
        if (res.error) throw res.error;
        return (res.data || []).map(mapMember);
      },

      updateDisplayName: async function (name) {
        var res = await client.rpc("update_display_name", { p_name: name });
        if (res.error) throw res.error;
      },

      updateHousehold: async function (name) {
        var res = await client
          .from("households")
          .update({ name: name })
          .eq("id", store.householdId)
          .select("id, name, invite_code, created_at")
          .single();
        if (res.error) throw res.error;
        return mapHousehold(res.data);
      },

      rotateInviteCode: async function () {
        var res = await client.rpc("rotate_invite_code");
        if (res.error) throw res.error;
        return res.data;
      },

      getAccessSettings: async function () {
        var res = await client.rpc("get_access_settings");
        if (res.error) throw res.error;
        return res.data || null;
      },

      setAccessCode: async function (code) {
        var res = await client.rpc("set_access_code", { p_code: code || null });
        if (res.error) throw res.error;
        return res.data;
      },

      regenerateAccessCode: function () {
        return store.setAccessCode(null);
      },

      listEntries: async function (month) {
        var range = EFB.monthRange(month);
        var res = await client
          .from("entries")
          .select("*")
          .eq("household_id", store.householdId)
          .gte("entry_date", range.start)
          .lte("entry_date", range.end)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false });
        if (res.error) throw res.error;
        return (res.data || []).map(mapEntry);
      },

      addEntry: async function (payload) {
        var res = await client
          .from("entries")
          .insert({
            household_id: store.householdId,
            created_by: store.userId,
            entry_date: payload.date,
            type: payload.type,
            category: payload.category,
            description: payload.description,
            amount: Number(payload.amount)
          })
          .select("*")
          .single();
        if (res.error) throw res.error;
        return mapEntry(res.data);
      },

      updateEntry: async function (id, patch) {
        var update = {};
        if (patch.date != null) update.entry_date = patch.date;
        if (patch.type != null) update.type = patch.type;
        if (patch.category != null) update.category = patch.category;
        if (patch.description != null) update.description = patch.description;
        if (patch.amount != null) update.amount = Number(patch.amount);

        var res = await client.from("entries").update(update).eq("id", id).select("*").single();
        if (res.error) throw res.error;
        return mapEntry(res.data);
      },

      deleteEntry: async function (id) {
        var res = await client.from("entries").delete().eq("id", id);
        if (res.error) throw res.error;
      },

      listMenu: async function () {
        var res = await client
          .from("menu_items")
          .select("*")
          .eq("household_id", store.householdId)
          .order("kind", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true });
        if (res.error) throw res.error;
        return (res.data || []).map(mapMenu);
      },

      addMenuItem: async function (payload) {
        var res = await client
          .from("menu_items")
          .insert({
            household_id: store.householdId,
            name: payload.name,
            category: payload.category,
            kind: payload.kind,
            default_amount: Number(payload.defaultAmount) || 0,
            sort_order: Number(payload.sortOrder) || 0
          })
          .select("*")
          .single();
        if (res.error) throw res.error;
        return mapMenu(res.data);
      },

      updateMenuItem: async function (id, patch) {
        var update = {};
        if (patch.name != null) update.name = patch.name;
        if (patch.category != null) update.category = patch.category;
        if (patch.kind != null) update.kind = patch.kind;
        if (patch.defaultAmount != null) update.default_amount = Number(patch.defaultAmount) || 0;
        if (patch.sortOrder != null) update.sort_order = Number(patch.sortOrder) || 0;

        var res = await client.from("menu_items").update(update).eq("id", id).select("*").single();
        if (res.error) throw res.error;
        return mapMenu(res.data);
      },

      deleteMenuItem: async function (id) {
        var res = await client.from("menu_items").delete().eq("id", id);
        if (res.error) throw res.error;
      },

      exportAll: async function () {
        var results = await Promise.all([
          client.from("entries").select("*").eq("household_id", store.householdId).order("entry_date", { ascending: true }),
          client.from("menu_items").select("*").eq("household_id", store.householdId),
          client.from("household_members").select("household_id, user_id, display_name, role, joined_at").eq("household_id", store.householdId),
          client.from("households").select("id, name, invite_code, created_at").eq("id", store.householdId).maybeSingle()
        ]);

        for (var i = 0; i < results.length; i++) {
          if (results[i].error) throw friendlyDbError(results[i].error);
        }

        return {
          exportedAt: new Date().toISOString(),
          household: mapHousehold(results[3].data),
          members: (results[2].data || []).map(mapMember),
          entries: (results[0].data || []).map(mapEntry),
          menu: (results[1].data || []).map(mapMenu)
        };
      },

      subscribe: function (cb) {
        if (!store.householdId) return null;
        var channel = client.channel("efb-" + store.householdId);
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "entries",
            filter: "household_id=eq." + store.householdId
          },
          cb
        );
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "menu_items",
            filter: "household_id=eq." + store.householdId
          },
          cb
        );
        channel.subscribe();
        return channel;
      },

      unsubscribe: function (channel) {
        if (channel) client.removeChannel(channel);
      },

      startDemo: function () {
        throw new Error("Supabase sudah terhubung. Mode demo tidak diperlukan.");
      },

      resetDemo: function () {
        throw new Error("Mode demo tidak aktif.");
      }
    };

    return store;
  }

  /* ==========================================================
   * DEMO (localStorage)
   * ========================================================== */
  var DEMO_KEY = "efb_demo_v1";
  var DEMO_ACTIVE = "efb_demo_active";
  var DEMO_HOUSEHOLD_ID = "demo-household";
  var DEMO_USER = {
    id: "demo-user",
    email: "demo@lokal",
    user_metadata: { display_name: "Taro (Demo)" }
  };

  function demoMenuSeed() {
    var raw = [
      ["Tempe Goreng", "Masak Kos", "masak", 3000, 1],
      ["Tempe Goreng Tepung", "Masak Kos", "masak", 4000, 2],
      ["Tempe Orek Kecap", "Masak Kos", "masak", 5000, 3],
      ["Tahu Goreng", "Masak Kos", "masak", 3000, 4],
      ["Tahu Goreng Tepung (Bakwan)", "Masak Kos", "masak", 4000, 5],
      ["Telur Dadar", "Masak Kos", "masak", 3000, 6],
      ["Telur Ceplok", "Masak Kos", "masak", 3000, 7],
      ["Omelet", "Masak Kos", "masak", 5000, 8],
      ["Mie All Around", "Masak Kos", "masak", 7000, 9],
      ["Tahu Kocek Level Max", "Jajan", "jajan", 10000, 1],
      ["Siwil Petis", "Jajan", "jajan", 10000, 2],
      ["Pok Pok", "Jajan", "jajan", 8000, 3],
      ["Otak Otak Full Chili Oil", "Jajan", "jajan", 12000, 4],
      ["Pentol Full Kuah (10k berdua)", "Jajan", "jajan", 10000, 5],
      ["Gorengan 1k (8-10k berdua)", "Jajan", "jajan", 9000, 6],
      ["Chuba Buat Kondimen", "Jajan", "jajan", 5000, 7]
    ];

    return raw.map(function (item) {
      return {
        id: EFB.uid(),
        householdId: DEMO_HOUSEHOLD_ID,
        name: item[0],
        category: item[1],
        kind: item[2],
        defaultAmount: item[3],
        sortOrder: item[4],
        createdAt: new Date().toISOString()
      };
    });
  }

  function demoSeed() {
    var now = new Date();
    var current = EFB.monthKey(now);
    var next = EFB.plusMonth(current, 1);
    var entries = [];

    function add(month, day, type, category, description, amount) {
      var range = EFB.monthRange(month);
      if (day > range.days) return;
      entries.push({
        id: EFB.uid(),
        householdId: DEMO_HOUSEHOLD_ID,
        createdBy: DEMO_USER.id,
        date: month + "-" + EFB.pad2(day),
        type: type,
        category: category,
        description: description,
        amount: Number(amount),
        createdAt: new Date().toISOString()
      });
    }

    add(current, 1, "budget", BUDGET_CATEGORY, "Budget awal " + EFB.monthLabel(current), 1000000);
    add(next, 1, "budget", BUDGET_CATEGORY, "Budget awal " + EFB.monthLabel(next), 1000000);

    add(current, 27, "expense", "Jajan", "Jotoast", 20000);
    add(current, 28, "expense", "Masak Kos", "Masak telur + nasi", 6000);
    add(current, 28, "expense", "Makan Pokok", "Tahukck nasi", 14000);
    add(current, 29, "expense", "Makan Pokok", "Lamongan", 18000);
    add(current, 29, "expense", "Jajan", "Jotoast", 20000);
    add(current, 30, "expense", "Jajan", "Pok Pok Jamur", 13000);
    add(current, 30, "expense", "Jajan", "Otak Otak Nasi", 14000);
    add(next, 1, "expense", "Jajan", "Pok Pok Usus", 14000);

    return {
      household: {
        id: DEMO_HOUSEHOLD_ID,
        name: "Rumah Tangga Demo",
        inviteCode: "DEMO01",
        createdAt: new Date().toISOString()
      },
      members: [
        {
          householdId: DEMO_HOUSEHOLD_ID,
          userId: DEMO_USER.id,
          displayName: "Taro (Demo)",
          role: "owner",
          joinedAt: new Date().toISOString()
        },
        {
          householdId: DEMO_HOUSEHOLD_ID,
          userId: "demo-partner",
          displayName: "Pasangan (Demo)",
          role: "member",
          joinedAt: new Date().toISOString()
        }
      ],
      access: {
        code: "DEMO1",
        token: "demo" + "0".repeat(60)
      },
      entries: entries,
      menu: demoMenuSeed()
    };
  }

  function ensureDemoAccess(data) {
    if (!data.access || !data.access.code || !data.access.token) {
      data.access = {
        code: "DEMO1",
        token: "demo" + "0".repeat(60)
      };
      writeDemo(data);
    }
    return data;
  }

  function readDemo() {
    var raw = localStorage.getItem(DEMO_KEY);
    if (!raw) {
      var fresh = demoSeed();
      localStorage.setItem(DEMO_KEY, JSON.stringify(fresh));
      return fresh;
    }
    try {
      return ensureDemoAccess(JSON.parse(raw));
    } catch (e) {
      var fallback = demoSeed();
      localStorage.setItem(DEMO_KEY, JSON.stringify(fallback));
      return fallback;
    }
  }

  function writeDemo(data) {
    localStorage.setItem(DEMO_KEY, JSON.stringify(data));
  }

  function createDemoStore() {
    var store = {
      mode: "demo",
      hasBackend: false,

      init: function () {
        if (localStorage.getItem(DEMO_ACTIVE) === "1") {
          readDemo();
          return Promise.resolve({ user: DEMO_USER });
        }
        return Promise.resolve(null);
      },

      onAuthChange: function () {
        return null;
      },

      startDemo: function () {
        localStorage.setItem(DEMO_ACTIVE, "1");
        readDemo();
        return Promise.resolve({ user: DEMO_USER });
      },

      signIn: function () {
        return Promise.reject(new Error("Mode demo tidak memakai login. Klik Coba Mode Demo."));
      },

      signUp: function () {
        return Promise.reject(new Error("Mode demo tidak memakai login. Klik Coba Mode Demo."));
      },

      signInWithAccessCode: function () {
        return Promise.reject(new Error("Mode demo tidak memakai login kode."));
      },

      signInWithAccessToken: function () {
        return Promise.reject(new Error("Mode demo tidak memakai login kode."));
      },

      signOut: function () {
        localStorage.removeItem(DEMO_ACTIVE);
        return Promise.resolve();
      },

      getContext: function () {
        if (localStorage.getItem(DEMO_ACTIVE) !== "1") {
          return Promise.resolve({ user: null, membership: null, household: null });
        }
        var data = readDemo();
        var membership = data.members.filter(function (m) {
          return m.userId === DEMO_USER.id;
        })[0];
        return Promise.resolve({
          user: DEMO_USER,
          membership: membership,
          household: data.household
        });
      },

      createHousehold: function () {
        return Promise.reject(new Error("Mode demo sudah punya rumah tangga."));
      },

      joinHousehold: function () {
        return Promise.reject(new Error("Mode demo sudah punya rumah tangga."));
      },

      leaveHousehold: function () {
        return Promise.reject(new Error("Mode demo tidak bisa keluar. Gunakan Reset Data Demo."));
      },

      listMembers: function () {
        return Promise.resolve(readDemo().members.slice());
      },

      updateDisplayName: function (name) {
        var data = readDemo();
        data.members.forEach(function (m) {
          if (m.userId === DEMO_USER.id) m.displayName = name || "Anggota";
        });
        writeDemo(data);
        return Promise.resolve();
      },

      updateHousehold: function (name) {
        var data = readDemo();
        data.household.name = name;
        writeDemo(data);
        return Promise.resolve(data.household);
      },

      rotateInviteCode: function () {
        var data = readDemo();
        var code = "";
        var chars = "ABCDEF0123456789";
        for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        data.household.inviteCode = code;
        writeDemo(data);
        return Promise.resolve(code);
      },

      getAccessSettings: function () {
        return Promise.resolve(readDemo().access);
      },

      setAccessCode: function (code) {
        var data = readDemo();
        var next = code ? String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";

        if (next && next.length !== 5) {
          return Promise.reject(new Error("Kode harus 5 karakter huruf/angka."));
        }

        if (!next) {
          var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          next = "";
          for (var i = 0; i < 5; i++) next += chars[Math.floor(Math.random() * chars.length)];
        }

        var token = "";
        var tokenChars = "abcdef0123456789";
        for (var j = 0; j < 64; j++) {
          token += tokenChars[Math.floor(Math.random() * tokenChars.length)];
        }

        data.access = { code: next, token: token };
        writeDemo(data);
        return Promise.resolve(data.access);
      },

      regenerateAccessCode: function () {
        return store.setAccessCode(null);
      },

      listEntries: function (month) {
        var range = EFB.monthRange(month);
        var list = readDemo().entries.filter(function (e) {
          return e.date >= range.start && e.date <= range.end;
        });
        list.sort(function (a, b) {
          return b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt));
        });
        return Promise.resolve(list);
      },

      addEntry: function (payload) {
        var data = readDemo();
        var entry = {
          id: EFB.uid(),
          householdId: DEMO_HOUSEHOLD_ID,
          createdBy: DEMO_USER.id,
          date: payload.date,
          type: payload.type,
          category: payload.category,
          description: payload.description,
          amount: Number(payload.amount),
          createdAt: new Date().toISOString()
        };
        data.entries.push(entry);
        writeDemo(data);
        return Promise.resolve(entry);
      },

      updateEntry: function (id, patch) {
        var data = readDemo();
        var entry = data.entries.filter(function (e) {
          return e.id === id;
        })[0];
        if (!entry) return Promise.reject(new Error("Transaksi tidak ditemukan."));
        if (patch.date != null) entry.date = patch.date;
        if (patch.type != null) entry.type = patch.type;
        if (patch.category != null) entry.category = patch.category;
        if (patch.description != null) entry.description = patch.description;
        if (patch.amount != null) entry.amount = Number(patch.amount);
        writeDemo(data);
        return Promise.resolve(entry);
      },

      deleteEntry: function (id) {
        var data = readDemo();
        data.entries = data.entries.filter(function (e) {
          return e.id !== id;
        });
        writeDemo(data);
        return Promise.resolve();
      },

      listMenu: function () {
        var list = readDemo().menu.slice();
        list.sort(function (a, b) {
          if (a.kind !== b.kind) return a.kind === "masak" ? -1 : 1;
          return (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name);
        });
        return Promise.resolve(list);
      },

      addMenuItem: function (payload) {
        var data = readDemo();
        var maxSort = data.menu.reduce(function (max, item) {
          return Math.max(max, item.sortOrder || 0);
        }, 0);
        var item = {
          id: EFB.uid(),
          householdId: DEMO_HOUSEHOLD_ID,
          name: payload.name,
          category: payload.category,
          kind: payload.kind,
          defaultAmount: Number(payload.defaultAmount) || 0,
          sortOrder: maxSort + 1,
          createdAt: new Date().toISOString()
        };
        data.menu.push(item);
        writeDemo(data);
        return Promise.resolve(item);
      },

      updateMenuItem: function (id, patch) {
        var data = readDemo();
        var item = data.menu.filter(function (m) {
          return m.id === id;
        })[0];
        if (!item) return Promise.reject(new Error("Menu tidak ditemukan."));
        if (patch.name != null) item.name = patch.name;
        if (patch.category != null) item.category = patch.category;
        if (patch.kind != null) item.kind = patch.kind;
        if (patch.defaultAmount != null) item.defaultAmount = Number(patch.defaultAmount) || 0;
        writeDemo(data);
        return Promise.resolve(item);
      },

      deleteMenuItem: function (id) {
        var data = readDemo();
        data.menu = data.menu.filter(function (m) {
          return m.id !== id;
        });
        writeDemo(data);
        return Promise.resolve();
      },

      exportAll: function () {
        var data = readDemo();
        return Promise.resolve({
          exportedAt: new Date().toISOString(),
          household: data.household,
          members: data.members,
          entries: data.entries,
          menu: data.menu
        });
      },

      subscribe: function () {
        return null;
      },

      unsubscribe: function () {},

      resetDemo: function () {
        localStorage.removeItem(DEMO_KEY);
        var data = readDemo();
        localStorage.setItem(DEMO_ACTIVE, "1");
        return Promise.resolve(data);
      }
    };

    return store;
  }

  /* ==========================================================
   * PEMILIHAN STORE
   * ========================================================== */
  var hasBackend = Boolean(CFG.hasSupabase && global.supabase);
  var Store;

  if (hasBackend) {
    try {
      Store = createSupabaseStore();
    } catch (err) {
      console.error("Gagal membuat Supabase client:", err);
      Store = createDemoStore();
      Store.hasBackend = false;
      hasBackend = false;
    }
  } else {
    Store = createDemoStore();
  }

  Store.CATEGORIES = CATEGORIES;
  Store.BUDGET_CATEGORY = BUDGET_CATEGORY;
  Store.hasBackend = hasBackend;

  global.Store = Store;
})(window);

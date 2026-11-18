
/* VIBE CO. POS frontend
   Reads and writes through Apps Script JSONP.
   No browser CORS fetch is used.
*/

const API_URL = "https://script.google.com/macros/s/AKfycbzTe4Gardlu7Ds-6Q1_DSYhvG0IJltXSI3b0DUrb6iOvsXPMfkk11CY9dmZ3Hc9AMU/exec";

const state = {
  menu: [],
  categories: ["All"],
  category: "All",
  cart: [],
  payment: "Cash",
  orders: [],
  busy: false
};

const $ = id => document.getElementById(id);

const money = n => "₹" + (Number(n) || 0).toFixed(2);

const escapeHTML = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));


function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    node.classList.remove("show");
  }, 2800);
}


/* Google Apps Script JSONP connection */

function jsonp(action, params = {}) {
  return new Promise((resolve, reject) => {

    const callback =
      "vibeCallback_" + Date.now() + "_" +
      Math.floor(Math.random() * 100000);

    const script = document.createElement("script");

    const query = new URLSearchParams({
      action,
      callback,
      ...params
    });

    const timer = setTimeout(() => {
      finish(
        new Error(
          "The API did not respond in time. Check Apps Script deployment."
        )
      );
    }, 18000);

    function finish(error, data) {
      clearTimeout(timer);
      delete window[callback];
      script.remove();

      error ? reject(error) : resolve(data);
    }

    window[callback] = data => finish(null, data);

    script.onerror = () => {
      finish(
        new Error(
          "Could not reach Apps Script. Check the Web App URL and deployment access."
        )
      );
    };

    script.src = API_URL + "?" + query.toString();

    document.body.appendChild(script);
  });
}


function setConnection(ok, text) {
  $("statusDot").classList.toggle("online", !!ok);
  $("connectionStatus").textContent = text;
}


/* Menu */

function normaliseMenu(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      Product_ID: row.Product_ID || "",
      Product_Name: String(row.Product_Name || "").trim(),
      Category: String(row.Category || "Other").trim(),
      Price: Number(row.Price) || 0,
      Available: ![
        "false",
        "no",
        "0",
        "unavailable"
      ].includes(String(row.Available).toLowerCase())
    }))
    .filter(row => row.Product_Name && row.Price >= 0);
}


async function loadMenu() {
  setConnection(false, "Connecting to menu");

  $("menuGrid").innerHTML =
    '<div class="loading-card">Loading your menu…</div>';

  try {
    const result = await jsonp("getMenu");

    const rows = Array.isArray(result)
      ? result
      : (result.data || []);

    state.menu = normaliseMenu(rows);

    if (!state.menu.length) {
      throw new Error(
        "Menu is empty. Add products to the Menu sheet."
      );
    }

    state.categories = [
      "All",
      ...new Set(
        state.menu
          .filter(x => x.Available)
          .map(x => x.Category)
          .filter(Boolean)
      )
    ];

    state.category = "All";

    renderCategories();
    renderMenu();

    $("menuError").classList.add("hidden");

    setConnection(true, "Menu connected");

  } catch (error) {

    $("menuGrid").innerHTML =
      '<div class="loading-card">Menu could not be loaded.</div>';

    $("menuError").textContent = error.message;
    $("menuError").classList.remove("hidden");

    setConnection(false, "Connection issue");
  }
}


function renderCategories() {

  $("categoryList").innerHTML =
    state.categories.map(category => `
      <button
        class="category-btn ${category === state.category ? "active" : ""}"
        data-category="${escapeHTML(category)}">
        ${escapeHTML(category)}
      </button>
    `).join("");

  $("categoryList")
    .querySelectorAll("[data-category]")
    .forEach(button => {

      button.addEventListener("click", () => {

        state.category = button.dataset.category;

        renderCategories();
        renderMenu();

      });

    });
}


function renderMenu() {

  const query = $("menuSearch").value
    .trim()
    .toLowerCase();

  const products = state.menu.filter(item =>
    item.Available &&
    (
      state.category === "All" ||
      item.Category === state.category
    ) &&
    item.Product_Name.toLowerCase().includes(query)
  );

  if (!products.length) {

    $("menuGrid").innerHTML = `
      <div class="loading-card">
        ${state.menu.length
          ? "No matching items found."
          : "Your menu will appear here when connected."}
      </div>
    `;

    return;
  }

  $("menuGrid").innerHTML = products.map((item, index) => `
    <button class="menu-card" data-product-index="${index}">

      <div>
        <div class="menu-card-top">
          <h3>${escapeHTML(item.Product_Name)}</h3>
        </div>

        <div class="menu-category">
          ${escapeHTML(item.Category)}
        </div>
      </div>

      <div class="menu-card-bottom">
        <span>${money(item.Price)}</span>
        <span class="add-circle">+</span>
      </div>

    </button>
  `).join("");

  $("menuGrid")
    .querySelectorAll("[data-product-index]")
    .forEach(button => {

      button.addEventListener("click", () => {

        addItem(
          products[Number(button.dataset.productIndex)]
        );

      });

    });
}


/* Shopping cart */

function addItem(product) {

  const existing = state.cart.find(
    item => item.name === product.Product_Name
  );

  if (existing) {

    existing.quantity += 1;

  } else {

    state.cart.push({
      name: product.Product_Name,
      category: product.Category,
      price: product.Price,
      quantity: 1,
      notes: ""
    });

  }

  renderCart();
}


function changeQuantity(index, delta) {

  const item = state.cart[index];

  if (!item) return;

  item.quantity += delta;

  if (item.quantity <= 0) {
    state.cart.splice(index, 1);
  }

  renderCart();
}


function cartTotals() {

  const subtotal = state.cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const discount = Math.min(
    Math.max(0, Number($("discountInput").value) || 0),
    subtotal
  );

  return {
    subtotal,
    discount,
    total: Math.max(0, subtotal - discount)
  };
}


function renderCart() {

  const count = state.cart.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  $("itemCount").textContent =
    `${count} item${count === 1 ? "" : "s"}`;

  if (!state.cart.length) {

    $("cartItems").innerHTML =
      '<div class="cart-empty">Your bill is empty — tap any menu item below to add it</div>';

  } else {

    $("cartItems").innerHTML =
      state.cart.map((item, index) => `

        <div class="cart-line">

          <div class="cart-product">
            ${escapeHTML(item.name)}
          </div>

          <div class="cart-price">
            ${money(item.price * item.quantity)}
          </div>

          <div class="cart-controls">

            <button
              class="qty-btn"
              data-index="${index}"
              data-delta="-1"
              aria-label="Decrease quantity">−</button>

            <span class="qty-value">
              ${item.quantity}
            </span>

            <button
              class="qty-btn"
              data-index="${index}"
              data-delta="1"
              aria-label="Increase quantity">+</button>

            <span>${money(item.price)} each</span>

            <button
              class="remove-item"
              data-remove="${index}">
              Remove
            </button>

          </div>

          <input
            class="item-note"
            data-note-index="${index}"
            maxlength="250"
            placeholder="Item note (optional)"
            value="${escapeHTML(item.notes)}">

        </div>

      `).join("");

  }


  $("cartItems")
    .querySelectorAll("[data-index]")
    .forEach(button => {

      button.addEventListener("click", () => {

        changeQuantity(
          Number(button.dataset.index),
          Number(button.dataset.delta)
        );

      });

    });


  $("cartItems")
    .querySelectorAll("[data-remove]")
    .forEach(button => {

      button.addEventListener("click", () => {

        state.cart.splice(
          Number(button.dataset.remove),
          1
        );

        renderCart();

      });

    });


  $("cartItems")
    .querySelectorAll("[data-note-index]")
    .forEach(input => {

      input.addEventListener("input", () => {

        const item = state.cart[
          Number(input.dataset.noteIndex)
        ];

        if (item) {
          item.notes = input.value;
        }

      });

    });


  const totals = cartTotals();

  $("subtotal").textContent = money(totals.subtotal);
  $("total").textContent = money(totals.total);
  $("checkoutTotal").textContent = money(totals.total);

  $("saveOrder").disabled =
    !state.cart.length || state.busy;

}


/* Date helpers */

function parseDate(value) {

  if (value instanceof Date) return value;

  const text = String(value || "");

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (match) {

    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    );

  }

  const d = new Date(text);

  return isNaN(d) ? null : d;
}


function isToday(value) {

  const date = parseDate(value);

  if (!date) return false;

  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}


/* Order history */

async function loadOrders() {

  $("historyList").innerHTML =
    '<div class="loading-card">Loading orders…</div>';

  try {

    const result = await jsonp("getOrders");

    state.orders = Array.isArray(result)
      ? result
      : (result.data || []);

    renderHistory();
    renderSummary();

  } catch (error) {

    $("historyList").innerHTML = `
      <div class="empty-state">
        ${escapeHTML(error.message)}
      </div>
    `;

    toast("Could not load order history.");

  }
}


function todayOrders() {

  return state.orders.filter(order =>
    isToday(order.Date || order.Timestamp)
  );

}


function orderAmount(order) {
  return Number(order.Total || 0);
}


function renderHistory() {

  const todays = todayOrders();

  $("historyCount").textContent = todays.length;

  $("historySales").textContent = money(
    todays.reduce(
      (sum, order) => sum + orderAmount(order),
      0
    )
  );

  if (!state.orders.length) {

    $("historyList").innerHTML =
      '<div class="empty-state">No orders found yet. Your completed bills will appear here.</div>';

    return;
  }

  $("historyList").innerHTML =
    [...state.orders].reverse().map(order => `

      <article class="history-item">

        <div>

          <strong>
            ${escapeHTML(order.Order_ID || "Order")}
          </strong>

          <small>
            ${escapeHTML(order.Date || "")}
            ·
            ${escapeHTML(order.Time || "")}
            ·
            ${escapeHTML(
              order.Customer_Name ||
              order.Table_Name ||
              "Walk-in"
            )}
          </small>

          <small>
            ${escapeHTML(order.Payment_Method || "—")}
            ·
            ${escapeHTML(order.Payment_Status || "—")}
          </small>

        </div>

        <div class="history-total">
          ${money(order.Total)}
        </div>

      </article>

    `).join("");

}


/* Sales summary */

function renderSummary() {

  const todays = todayOrders();

  const revenue = todays.reduce(
    (sum, order) => sum + orderAmount(order),
    0
  );

  const cash = todays
    .filter(order =>
      String(order.Payment_Method).toLowerCase() === "cash"
    )
    .reduce(
      (sum, order) => sum + orderAmount(order),
      0
    );

  const upi = todays
    .filter(order =>
      String(order.Payment_Method).toLowerCase() === "upi"
    )
    .reduce(
      (sum, order) => sum + orderAmount(order),
      0
    );

  $("todayRevenue").textContent = money(revenue);

  $("todayOrders").textContent = todays.length;

  $("averageBill").textContent = money(
    todays.length ? revenue / todays.length : 0
  );

  $("paymentBreakdown").innerHTML =
    [["Cash", cash], ["UPI", upi]].map(
      ([label, value]) => `

        <div class="payment-bar-row">

          <span>${label}</span>

          <div class="bar-track">
            <div
              class="bar-fill"
              style="width:${revenue ? value / revenue * 100 : 0}%">
            </div>
          </div>

          <strong>${money(value)}</strong>

        </div>

      `
    ).join("");

  $("closingSnapshot").textContent =
    `Today's closing snapshot: ${todays.length} orders · Total sales ${money(revenue)} · Cash ${money(cash)} · UPI ${money(upi)}.`;

}


/* CSV exports */

function csvCell(value) {

  const text = String(value ?? "");

  return `"${text.replace(/"/g, '""')}"`;

}


function downloadCSV(filename, rows) {

  if (!rows.length) {

    toast("There is no data to export yet.");

    return;
  }

  const csv = rows
    .map(row => row.map(csvCell).join(","))
    .join("\r\n");

  const blob = new Blob(
    ["\ufeff" + csv],
    { type: "text/csv;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);

}


function exportOrders() {

  const headers = [
    "Order_ID",
    "Date",
    "Time",
    "Customer_Name",
    "Items_Count",
    "Subtotal",
    "Discount",
    "Total",
    "Payment_Method",
    "Payment_Status",
    "Notes"
  ];

  downloadCSV(
    "vibe-co-orders.csv",
    [
      headers,
      ...state.orders.map(order =>
        headers.map(header => order[header] ?? "")
      )
    ]
  );

}


async function exportItems() {

  try {

    const result = await jsonp("getOrderItems");

    const rows = Array.isArray(result)
      ? result
      : (result.data || []);

    if (!rows.length) {

      toast("No item records to export.");

      return;
    }

    const headers = Object.keys(rows[0]);

    downloadCSV(
      "vibe-co-order-items.csv",
      [
        headers,
        ...rows.map(row =>
          headers.map(header => row[header] ?? "")
        )
      ]
    );

  } catch (error) {

    toast("Item export failed: " + error.message);

  }

}


/* Save order */

async function saveOrder() {

  if (!state.cart.length || state.busy) return;

  const totals = cartTotals();

  if (totals.total <= 0) {

    toast("Order total must be greater than zero.");

    return;
  }

  const payload = {

    customerName: $("customerName").value.trim(),

    notes: $("orderNotes").value.trim(),

    paymentMethod: state.payment,

    discount: totals.discount,

    items: state.cart.map(item => ({

      name: item.name,

      quantity: item.quantity,

      notes: item.notes

    }))

  };


  state.busy = true;

  $("saveOrder").disabled = true;

  $("saveOrder").textContent = "Saving order…";


  try {

    const result = await jsonp(
      "createOrder",
      { data: JSON.stringify(payload) }
    );

    if (!result || result.success !== true) {

      throw new Error(
        result?.message || "The order could not be saved."
      );

    }

    toast(
      `Order ${result.orderId} saved successfully.`
    );

    state.cart = [];

    $("customerName").value = "";
    $("orderNotes").value = "";
    $("discountInput").value = "0";

    renderCart();

    await loadOrders();

  } catch (error) {

    toast("Order not saved: " + error.message);

  } finally {

    state.busy = false;

    $("saveOrder").innerHTML =
      `Complete order · <span id="checkoutTotal">${money(cartTotals().total)}</span>`;

    renderCart();

  }

}


/* Tabs */

function switchTab(tab) {

  document.querySelectorAll(".tab")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.tab === tab
      );

    });

  document.querySelectorAll(".view")
    .forEach(view => {

      view.classList.toggle(
        "active",
        view.id === "view-" + tab
      );

    });

  if (tab === "history" || tab === "summary") {
    loadOrders();
  }

}


/* Start application */

function init() {

  const now = new Date();

  $("headerDate").textContent =
    now.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short"
    });

  $("dateChip").textContent =
    now.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short"
    });


  document.querySelectorAll(".tab")
    .forEach(button => {

      button.addEventListener("click", () => {
        switchTab(button.dataset.tab);
      });

    });


  $("menuSearch").addEventListener(
    "input",
    renderMenu
  );

  $("discountInput").addEventListener(
    "input",
    renderCart
  );

  $("clearBill").addEventListener(
    "click",
    () => {
      state.cart = [];
      renderCart();
    }
  );

  $("saveOrder").addEventListener(
    "click",
    saveOrder
  );

  $("refreshHistory").addEventListener(
    "click",
    loadOrders
  );

  $("refreshSummary").addEventListener(
    "click",
    loadOrders
  );

  $("exportOrders").addEventListener(
    "click",
    exportOrders
  );

  $("exportItems").addEventListener(
    "click",
    exportItems
  );


  document.querySelectorAll(".payment-btn")
    .forEach(button => {

      button.addEventListener("click", () => {

        state.payment = button.dataset.payment;

        document.querySelectorAll(".payment-btn")
          .forEach(item => {

            item.classList.toggle(
              "active",
              item === button
            );

          });

      });

    });


  renderCart();

  loadMenu();

}


document.addEventListener(
  "DOMContentLoaded",
  init
);

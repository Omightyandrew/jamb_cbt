(function (window, document) {
  "use strict";

  var ROOT = "https://exampilot.com.ng";
  var LOGO = "/assets/logo/logo-compact.svg";
  var LIGHT_LOGO = "/assets/logo/logo-mono-light.svg";
  var SYMBOL = "/assets/logo/logo-symbol.svg";
  var FAVICON = "/assets/logo/favicon.svg";
  var APPLE_TOUCH_ICON = "/assets/logo/apple-touch-icon.png";
  var OG_IMAGE = "/assets/logo/og-image.png";

  var navigation = [
    ["JAMB", "/jamb/"],
    ["Practice Questions", "/jamb/practice-questions/"],
    ["Past Questions", "/jamb/past-questions/"],
    ["Syllabus", "/jamb/syllabus/"],
    ["Subjects", "/jamb/"],
    ["Resources", "/jamb/brochure/"]
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function resolveUrl(path) {
    return new URL(path || "/", ROOT + "/").href;
  }

  function linkMarkup(label, href, currentPath) {
    var current = currentPath && currentPath === href;
    return '<a href="' + escapeHtml(href) + '"' +
      (current ? ' aria-current="page"' : "") + ">" +
      escapeHtml(label) + "</a>";
  }

  function renderHeader(target, options) {
    var element = typeof target === "string" ? document.querySelector(target) : target;
    var settings = options || {};

    if (!element) {
      throw new Error("Public SEO header target was not found.");
    }

    var currentPath = settings.currentPath || "";
    var links = navigation.map(function (item) {
      return linkMarkup(item[0], item[1], currentPath);
    }).join("");

    element.innerHTML =
      '<header class="seo-header">' +
        '<div class="seo-container seo-header__inner">' +
          '<a class="seo-brand" href="/" aria-label="ExamPilot home">' +
            '<img class="ep-logo" src="' + escapeHtml(settings.logo || LOGO) + '" alt="ExamPilot">' +
          "</a>" +
          '<nav class="seo-primary-nav" aria-label="Primary navigation">' +
            links +
          "</nav>" +
          '<a class="seo-cta seo-cta--primary seo-header__cta" href="/student.html">Start Practicing</a>' +
          '<button class="seo-menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="public-mobile-nav">Menu</button>' +
        "</div>" +
        '<nav class="seo-mobile-nav seo-container" id="public-mobile-nav" aria-label="Mobile navigation" data-open="false" hidden>' +
          links +
          '<a class="seo-cta seo-cta--primary" href="/student.html">Start Practicing</a>' +
        "</nav>" +
      "</header>";

    var button = element.querySelector(".seo-menu-toggle");
    var mobileNav = element.querySelector("#public-mobile-nav");

    button.addEventListener("click", function () {
      var isOpen = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!isOpen));
      button.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
      mobileNav.dataset.open = String(!isOpen);
      mobileNav.hidden = isOpen;
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
        button.click();
        button.focus();
      }
    });
  }

  function renderBreadcrumbs(target, items) {
    var element = typeof target === "string" ? document.querySelector(target) : target;

    if (!element) {
      throw new Error("Public SEO breadcrumb target was not found.");
    }

    if (!Array.isArray(items) || !items.length) {
      throw new Error("Public SEO breadcrumbs require at least one item.");
    }

    element.innerHTML =
      '<nav class="seo-breadcrumbs" aria-label="Breadcrumb">' +
        "<ol>" +
          items.map(function (item, index) {
            var isCurrent = index === items.length - 1;
            if (isCurrent) {
              return '<li aria-current="page">' + escapeHtml(item.label) + "</li>";
            }
            return "<li>" + linkMarkup(item.label, item.href) + "</li>";
          }).join("") +
        "</ol>" +
      "</nav>";
  }

  function upsertMeta(attribute, value, content) {
    if (!content) {
      return;
    }

    var selector = "meta[" + attribute + '="' + value.replace(/"/g, '\\"') + '"]';
    var element = document.head.querySelector(selector);

    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, value);
      document.head.appendChild(element);
    }

    element.setAttribute("content", content);
  }

  function setCanonical(href) {
    var canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = resolveUrl(href);
  }

  function ensureBrandLinks() {
    var favicon = document.head.querySelector('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      favicon.type = "image/svg+xml";
      document.head.appendChild(favicon);
    }
    favicon.href = FAVICON;

    var appleIcon = document.head.querySelector('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
      appleIcon = document.createElement("link");
      appleIcon.rel = "apple-touch-icon";
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = APPLE_TOUCH_ICON;
  }

  function setMetadata(options) {
    var settings = options || {};
    var title = String(settings.title || "").trim();
    var description = String(settings.description || "").trim();
    var canonical = settings.canonical || "/";
    var robots = settings.robots || "index,follow";
    var image = settings.image || OG_IMAGE;
    var absoluteImage = resolveUrl(image);
    var absoluteCanonical = resolveUrl(canonical);

    if (!title || !description) {
      throw new Error("Public SEO metadata requires a title and description.");
    }

    document.title = title;
    ensureBrandLinks();
    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", robots);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:site_name", "ExamPilot");
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", absoluteCanonical);
    upsertMeta("property", "og:image", absoluteImage);
    upsertMeta("property", "og:image:alt", "ExamPilot");
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", absoluteImage);
    upsertMeta("name", "twitter:image:alt", "ExamPilot");
    setCanonical(canonical);
  }

  function addStructuredData(data) {
    if (!data || typeof data !== "object" || !data["@type"]) {
      throw new Error("Structured data requires an object with an @type.");
    }

    var script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
    return script;
  }

  function organizationData() {
    return {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "ExamPilot",
      url: ROOT + "/",
      logo: resolveUrl("/assets/logo/logo-compact.svg")
    };
  }

  function websiteData() {
    return {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "ExamPilot",
      url: ROOT + "/",
      publisher: { "@id": ROOT + "/#organization" }
    };
  }

  function webpageData(options) {
    var settings = options || {};
    return {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: settings.name,
      url: resolveUrl(settings.url || "/"),
      description: settings.description,
      isPartOf: { "@id": ROOT + "/#website" },
      publisher: { "@id": ROOT + "/#organization" }
    };
  }

  function breadcrumbData(items) {
    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: (items || []).map(function (item, index) {
        return {
          "@type": "ListItem",
          position: index + 1,
          name: item.label,
          item: resolveUrl(item.href || "/")
        };
      })
    };
  }

  window.ExamPilotPublicSEO = {
    addStructuredData: addStructuredData,
    breadcrumbData: breadcrumbData,
    organizationData: organizationData,
    renderBreadcrumbs: renderBreadcrumbs,
    renderFooter: renderFooter,
    renderHeader: renderHeader,
    setMetadata: setMetadata,
    websiteData: websiteData,
    webpageData: webpageData,
    assets: {
      favicon: FAVICON,
      logo: LOGO,
      lightLogo: LIGHT_LOGO,
      ogImage: OG_IMAGE,
      symbol: SYMBOL
    }
  };

  function renderFooter(target) {
    var element = typeof target === "string" ? document.querySelector(target) : target;

    if (!element) {
      throw new Error("Public SEO footer target was not found.");
    }

    element.innerHTML =
      '<footer class="seo-footer">' +
        '<div class="seo-container">' +
          '<div class="seo-footer__grid">' +
            '<div class="seo-footer__brand">' +
              '<a class="seo-brand" href="/" aria-label="ExamPilot home">' +
                '<img class="ep-logo" src="' + LIGHT_LOGO + '" alt="ExamPilot">' +
              "</a>" +
              '<p class="seo-footer__description">Prepare for JAMB with focused practice, syllabus guidance and subject-based study resources.</p>' +
            "</div>" +
            '<div><h2>JAMB</h2><ul>' +
              '<li><a href="/jamb/">JAMB preparation</a></li>' +
              '<li><a href="/jamb/cbt/">JAMB CBT</a></li>' +
              '<li><a href="/jamb/syllabus/">JAMB syllabus</a></li>' +
            "</ul></div>" +
            '<div><h2>Practice</h2><ul>' +
              '<li><a href="/jamb/practice-questions/">Practice Questions</a></li>' +
              '<li><a href="/jamb/past-questions/">Past Questions</a></li>' +
              '<li><a href="/jamb/">Subjects</a></li>' +
            "</ul></div>" +
            '<div><h2>Resources</h2><ul>' +
              '<li><a href="/jamb/brochure/">Brochure</a></li>' +
              '<li><a href="/jamb/preparation-guide/">Preparation Guide</a></li>' +
              '<li><a href="/student.html">Create an account</a></li>' +
            "</ul></div>" +
          "</div>" +
          '<div class="seo-footer__bottom"><span>© ' + new Date().getFullYear() + " ExamPilot</span><span>Study smarter. Prepare with purpose.</span></div>" +
        "</div>" +
      "</footer>";
  }
}(window, document));

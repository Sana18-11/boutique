/**
 * YAALE LUXURY MOTION & INTERACTION ENGINE
 * Built with GSAP + ScrollTrigger (pinned versions from CDN)
 *
 * Colour palette:
 * --bg-main: #FBFAF7
 * --bg-soft: #F3EEE8
 * --bg-dark: #2B1C1A
 * --maroon: #7A0C32
 * --maroon-deep: #4E1D16
 * --red: #880001
 * --terracotta: #A33B1B
 * --copper: #BC7442
 * --gold: #C9A227
 * --text-main: #2B1C1A
 * --text-muted: #8A7F7C
 * --line: #E3DCD6
 * --text-on-dark: #FBFAF7
 */

document.addEventListener('DOMContentLoaded', () => {
  // Cleanup any lingering cursor elements if previously created
  const oldDot = document.getElementById('yaale-cursor-dot');
  if (oldDot) oldDot.remove();
  const oldRing = document.getElementById('yaale-cursor-ring');
  if (oldRing) oldRing.remove();

  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') {
    console.warn('[Yaale Motion] GSAP or ScrollTrigger is missing.');
    return;
  }

  // Register GSAP plugins once
  gsap.registerPlugin(ScrollTrigger);

  // Check prefers-reduced-motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    console.info('[Yaale Motion] prefers-reduced-motion detected. All motion disabled.');
    return;
  }

  // Set up responsive matchMedia
  const mm = gsap.matchMedia();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SCROLL PROGRESS BAR
  // ─────────────────────────────────────────────────────────────────────────────
  let progressBar = document.getElementById('yaale-scroll-progress');
  if (!progressBar) {
    progressBar = document.createElement('div');
    progressBar.id = 'yaale-scroll-progress';
    document.body.appendChild(progressBar);
  }

  gsap.to(progressBar, {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: document.body,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.15,
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. LOGO INTRO & FULL-SCREEN PRELOADER
  // ─────────────────────────────────────────────────────────────────────────────
  const initLogoIntro = () => {
    const hasSeenIntro = sessionStorage.getItem('yaale_intro_played');
    if (hasSeenIntro) {
      return;
    }

    const preloader = document.createElement('div');
    preloader.id = 'yaale-preloader';
    preloader.innerHTML = `
      <button class="yaale-preloader-skip" id="yaale-skip-intro" aria-label="Skip introduction">Skip &rarr;</button>
      <div class="yaale-preloader-logo-wrap" id="yaale-preloader-logo-wrap">
        <img src="/yaale-logo-transparent.png" alt="Yaale" class="yaale-preloader-logo" id="yaale-intro-logo" />
      </div>
    `;
    document.body.prepend(preloader);

    const logoWrap = document.getElementById('yaale-preloader-logo-wrap');
    const skipBtn = document.getElementById('yaale-skip-intro');

    let finished = false;
    const completeIntro = () => {
      if (finished) return;
      finished = true;
      sessionStorage.setItem('yaale_intro_played', 'true');
      preloader.classList.add('fade-out');
      setTimeout(() => {
        if (preloader.parentNode) preloader.parentNode.removeChild(preloader);
        ScrollTrigger.refresh();
      }, 650);

      revealHero();
    };

    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        completeIntro();
      });
    }

    gsap.set(logoWrap, { opacity: 0, scale: 0.85 });
    gsap.to(logoWrap, {
      opacity: 1,
      scale: 1,
      duration: 0.7,
      ease: 'power2.out',
      onComplete: () => {
        setTimeout(() => {
          if (finished) return;

          const navLogoImg = document.querySelector('header img[src*="yaale-logo"]');
          if (navLogoImg && logoWrap) {
            const navRect = navLogoImg.getBoundingClientRect();
            const preRect = logoWrap.getBoundingClientRect();

            const targetScale = Math.max(0.3, navRect.width / preRect.width);
            const targetX = (navRect.left + navRect.width / 2) - (preRect.left + preRect.width / 2);
            const targetY = (navRect.top + navRect.height / 2) - (preRect.top + preRect.height / 2);

            gsap.to(logoWrap, {
              x: targetX,
              y: targetY,
              scale: targetScale,
              duration: 0.95,
              ease: 'power3.inOut',
              onComplete: completeIntro,
            });

            gsap.to(preloader, {
              backgroundColor: 'rgba(251, 250, 247, 0)',
              duration: 0.7,
              delay: 0.35,
              ease: 'power2.out',
            });
          } else {
            completeIntro();
          }
        }, 1000);
      },
    });
  };

  const revealHero = () => {
    const heroH1 = document.querySelector('section h1');
    const heroP = document.querySelector('section h1 + p');
    const heroButtons = document.querySelectorAll('section h1 ~ div button');

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (heroH1) {
      tl.fromTo(
        heroH1,
        { opacity: 0, y: 35 },
        { opacity: 1, y: 0, duration: 0.9 }
      );
    }
    if (heroP) {
      tl.fromTo(
        heroP,
        { opacity: 0, y: 25 },
        { opacity: 1, y: 0, duration: 0.8 },
        '-=0.6'
      );
    }
    if (heroButtons && heroButtons.length > 0) {
      tl.fromTo(
        heroButtons,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, stagger: 0.12, duration: 0.7 },
        '-=0.5'
      );
    }
  };

  initLogoIntro();

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. NAVBAR SMART SCROLL (Hide on Down, Show on Up + Blurred Glass Bar)
  // ─────────────────────────────────────────────────────────────────────────────
  const initNavbar = () => {
    const header = document.querySelector('header');
    if (!header) return;

    header.classList.add('yaale-header');

    let lastScrollY = window.scrollY;
    let ticking = false;

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;

          // Glass effect past hero
          if (currentScrollY > 60) {
            header.classList.add('nav-glass');
          } else {
            header.classList.remove('nav-glass');
          }

          // Hide on scroll down, show on scroll up
          if (currentScrollY > 160 && currentScrollY > lastScrollY + 8) {
            header.classList.add('nav-hidden');
          } else if (currentScrollY < lastScrollY - 6 || currentScrollY <= 80) {
            header.classList.remove('nav-hidden');
          }

          lastScrollY = Math.max(0, currentScrollY);
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  };

  initNavbar();

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. WORD-BY-WORD HEADING REVEAL
  // ─────────────────────────────────────────────────────────────────────────────
  const initWordReveals = () => {
    const headings = document.querySelectorAll('h2.font-serif, .reveal-words');
    headings.forEach((heading) => {
      if (heading.dataset.revealed === 'true') return;

      if (heading.children.length === 0 && heading.textContent) {
        const words = heading.textContent.trim().split(/\s+/);
        if (words.length > 1) {
          heading.innerHTML = words
            .map((w) => `<span class="word-reveal-wrap"><span class="word-reveal-inner">${w}</span></span>`)
            .join(' ');
          heading.dataset.revealed = 'true';

          const inners = heading.querySelectorAll('.word-reveal-inner');
          gsap.fromTo(
            inners,
            { y: '110%', opacity: 0 },
            {
              y: '0%',
              opacity: 1,
              stagger: 0.04,
              duration: 0.8,
              ease: 'power3.out',
              scrollTrigger: {
                trigger: heading,
                start: 'top 88%',
                once: true,
              },
            }
          );
        }
      }
    });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. CURVED & WAVY SECTION DIVIDERS (--maroon-deep & --maroon)
  // ─────────────────────────────────────────────────────────────────────────────
  const createWaveDivider = (waveColor, nextBgColor, flipped = false) => {
    const wrap = document.createElement('div');
    wrap.className = 'yaale-wave-divider';
    if (nextBgColor) wrap.style.backgroundColor = nextBgColor;
    if (flipped) wrap.style.transform = 'rotate(180deg)';

    wrap.innerHTML = `
      <svg viewBox="0 0 1440 88" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
        <path d="M0,32 C320,84 720,-12 1120,44 C1280,68 1380,56 1440,48 L1440,88 L0,88 Z" fill="${waveColor}"></path>
      </svg>
    `;
    return wrap;
  };

  const insertSectionDividers = () => {
    const sections = document.querySelectorAll('section');
    if (sections.length < 3) return;

    if (document.querySelector('.yaale-wave-divider')) return;

    // 1. Below Hero (Dark #2B1C1A) -> Categories (#FBFAF7)
    // Divider uses --maroon-deep (#4E1D16) with --bg-main (#FBFAF7)
    if (sections[0] && sections[1]) {
      const wave1 = createWaveDivider('#4E1D16', '#FBFAF7');
      sections[0].insertAdjacentElement('afterend', wave1);
      gsap.fromTo(
        wave1.querySelector('path'),
        { x: -35 },
        {
          x: 35,
          ease: 'none',
          scrollTrigger: {
            trigger: wave1,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1,
          },
        }
      );
    }

    // 2. Below Categories -> New Arrivals (#F3EEE8)
    // Divider uses --maroon (#7A0C32) with --bg-soft (#F3EEE8)
    const newArrivals = document.querySelector('section.bg-cream');
    if (newArrivals) {
      const wave2 = createWaveDivider('#7A0C32', '#F3EEE8');
      newArrivals.insertAdjacentElement('beforebegin', wave2);
      gsap.fromTo(
        wave2.querySelector('path'),
        { x: 30 },
        {
          x: -30,
          ease: 'none',
          scrollTrigger: {
            trigger: wave2,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1,
          },
        }
      );
    }

    // 3. Above Testimonials Stats Strip (Dark #2B1C1A)
    // Divider uses --maroon-deep (#4E1D16) with --bg-dark (#2B1C1A)
    const statsSection = document.querySelector('section.bg-charcoal.py-16');
    if (statsSection) {
      const wave3 = createWaveDivider('#4E1D16', '#2B1C1A');
      statsSection.insertAdjacentElement('beforebegin', wave3);
      gsap.fromTo(
        wave3.querySelector('path'),
        { x: -40 },
        {
          x: 40,
          ease: 'none',
          scrollTrigger: {
            trigger: wave3,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1,
          },
        }
      );
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. ENDLESS MARQUEE STRIP
  // ─────────────────────────────────────────────────────────────────────────────
  const insertMarquee = () => {
    if (document.getElementById('yaale-luxury-marquee')) return;

    const targetSection = document.querySelector('section.bg-cream');
    if (!targetSection) return;

    const marquee = document.createElement('div');
    marquee.id = 'yaale-luxury-marquee';
    marquee.className = 'yaale-marquee-container';

    const words = [
      'Kanjivaram Silk',
      'Handcrafted Weaves',
      'Timeless Drapes',
      'Artisanal Zari',
      'Bridal Celebrations',
      'Festive Radiance',
      'Pure Soft Silk',
      'Graceful Heritage',
    ];

    const itemHtml = words
      .map(
        (word, idx) => `
        <div class="yaale-marquee-item">
          <span>${idx % 2 === 1 ? `<em>${word}</em>` : word}</span>
          <span class="yaale-marquee-dot"></span>
        </div>
      `
      )
      .join('');

    marquee.innerHTML = `
      <div class="yaale-marquee-track" id="yaale-marquee-track">
        ${itemHtml}
        ${itemHtml}
        ${itemHtml}
      </div>
    `;

    targetSection.insertAdjacentElement('afterend', marquee);

    const track = document.getElementById('yaale-marquee-track');
    if (!track) return;

    const marqueeTween = gsap.to(track, {
      xPercent: -33.333,
      duration: 24,
      ease: 'none',
      repeat: -1,
    });

    marquee.addEventListener('mouseenter', () => marqueeTween.pause());
    marquee.addEventListener('mouseleave', () => marqueeTween.play());
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. CATEGORIES AS ROUND ITSELF
  // ─────────────────────────────────────────────────────────────────────────────
  const initCategoryArchMasks = () => {
    const categoryWraps = document.querySelectorAll('.aspect-square');
    categoryWraps.forEach((card) => {
      card.classList.add('yaale-category-arch');
      // Ensure full circular rounded mask
      card.style.borderRadius = '9999px';
      const img = card.querySelector('img');
      if (img) img.style.borderRadius = '9999px';
    });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. PRODUCT ROWS MOMENTUM DRAG & STAGGER
  // ─────────────────────────────────────────────────────────────────────────────
  const initProductDragsAndStaggers = () => {
    const productGrids = document.querySelectorAll('.grid.grid-cols-2');
    productGrids.forEach((grid) => {
      const cards = grid.children;
      if (!cards || cards.length === 0) return;

      Array.from(cards).forEach((c) => {
        c.classList.add('product-card-motion', 'yaale-stagger-card');
      });

      gsap.fromTo(
        cards,
        { opacity: 0, x: 35, y: 15 },
        {
          opacity: 1,
          x: 0,
          y: 0,
          stagger: 0.08,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: grid,
            start: 'top 86%',
            once: true,
          },
        }
      );
    });

    const scrollContainers = document.querySelectorAll('[class*="overflow-x-auto"]');
    scrollContainers.forEach((container) => {
      container.classList.add('yaale-drag-carousel');
      let isDown = false;
      let startX = 0;
      let scrollLeft = 0;
      let velX = 0;
      let momentumID = null;

      container.addEventListener('mousedown', (e) => {
        isDown = true;
        container.classList.add('is-dragging');
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
        velX = 0;
        cancelAnimationFrame(momentumID);
      });

      const stopDrag = () => {
        if (!isDown) return;
        isDown = false;
        container.classList.remove('is-dragging');

        const step = () => {
          if (Math.abs(velX) > 0.5) {
            container.scrollLeft += velX;
            velX *= 0.92;
            momentumID = requestAnimationFrame(step);
          }
        };
        momentumID = requestAnimationFrame(step);
      };

      container.addEventListener('mouseleave', stopDrag);
      container.addEventListener('mouseup', stopDrag);

      container.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 1.5;
        const prevScroll = container.scrollLeft;
        container.scrollLeft = scrollLeft - walk;
        velX = container.scrollLeft - prevScroll;
      });
    });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. MAGNETIC BUTTONS (Desktop) & PRESS (Mobile)
  // ─────────────────────────────────────────────────────────────────────────────
  const initButtonsMotion = () => {
    const buttons = document.querySelectorAll('button:not(#yaale-skip-intro)');
    buttons.forEach((btn) => {
      btn.classList.add('btn-magnetic');

      btn.addEventListener('mousemove', (e) => {
        if (window.innerWidth < 1024) return;
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        gsap.to(btn, {
          x: x * 0.22,
          y: y * 0.22,
          duration: 0.25,
          ease: 'power2.out',
        });
      });

      btn.addEventListener('mouseleave', () => {
        if (window.innerWidth < 1024) return;
        gsap.to(btn, {
          x: 0,
          y: 0,
          duration: 0.5,
          ease: 'elastic.out(1, 0.4)',
        });
      });

      btn.addEventListener('touchstart', () => {
        gsap.to(btn, { scale: 0.95, duration: 0.1 });
      }, { passive: true });

      btn.addEventListener('touchend', () => {
        gsap.to(btn, { scale: 1, duration: 0.25, ease: 'back.out(2)' });
      }, { passive: true });
    });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. ROUND FLOATING "ADD TO CART" BUTTON & DRIFT
  // ─────────────────────────────────────────────────────────────────────────────
  const initFeaturedBanner = () => {
    const banner = document.querySelector('section.h-\\[70vh\\]') ||
      Array.from(document.querySelectorAll('section')).find((s) => s.textContent && s.textContent.includes('Celebrations'));
    if (!banner) return;

    banner.style.position = 'relative';

    // Round floating "Add to cart" button with --maroon background and --gold icon
    if (!banner.querySelector('.yaale-floating-badge')) {
      const badge = document.createElement('div');
      badge.className = 'yaale-floating-badge';
      badge.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A227" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
          <span style="color:#C9A227;font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Add to Cart</span>
        </div>
      `;
      banner.appendChild(badge);

      banner.addEventListener('mousemove', (e) => {
        if (window.innerWidth < 1024) return;
        const rect = banner.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        gsap.to(badge, {
          x: x,
          y: y,
          duration: 0.8,
          ease: 'power2.out',
        });
      });

      gsap.to(badge, {
        y: '+=50',
        ease: 'none',
        scrollTrigger: {
          trigger: banner,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.5,
        },
      });
    }

    const bannerImg = banner.querySelector('img');
    if (bannerImg) {
      gsap.fromTo(
        bannerImg,
        { yPercent: -10, scale: 1.1 },
        {
          yPercent: 10,
          scale: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: banner,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1,
          },
        }
      );
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. RESPONSIVE BREAKPOINT BEHAVIORS (matchMedia)
  // ─────────────────────────────────────────────────────────────────────────────
  mm.add('(min-width: 1024px)', () => {
    // Hero Layered Parallax
    const heroSection = document.querySelector('section.h-\\[90vh\\]') || document.querySelector('section');
    if (heroSection) {
      const heroImgs = heroSection.querySelectorAll('img');
      const heroContent = heroSection.querySelector('.max-w-2xl');

      if (heroImgs.length > 0) {
        gsap.to(heroImgs, {
          yPercent: 18,
          ease: 'none',
          scrollTrigger: {
            trigger: heroSection,
            start: 'top top',
            end: 'bottom top',
            scrub: 1,
          },
        });
      }

      if (heroContent) {
        gsap.to(heroContent, {
          yPercent: -20,
          opacity: 0.2,
          ease: 'none',
          scrollTrigger: {
            trigger: heroSection,
            start: 'top top',
            end: 'bottom top',
            scrub: 1,
          },
        });
      }

      gsap.to(heroSection, {
        scale: 1.04,
        opacity: 0.85,
        ease: 'none',
        scrollTrigger: {
          trigger: heroSection,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      });
    }

    // Pinned Horizontal Scroll on Best Sellers / Featured Row
    const bestSellersSection = Array.from(document.querySelectorAll('section')).find(
      (s) => s.textContent && s.textContent.includes('Best Sellers')
    );

    if (bestSellersSection) {
      const grid = bestSellersSection.querySelector('.grid');
      if (grid && !bestSellersSection.dataset.pinnedInit) {
        bestSellersSection.dataset.pinnedInit = 'true';
        bestSellersSection.classList.add('yaale-featured-scroll-wrap');

        const cards = Array.from(grid.children);
        if (cards.length > 2) {
          const track = document.createElement('div');
          track.className = 'yaale-pinned-track';

          cards.forEach((card) => {
            card.classList.add('yaale-pinned-item');
            track.appendChild(card);
          });

          grid.replaceWith(track);

          const getScrollDistance = () => track.scrollWidth - track.clientWidth + 60;

          gsap.to(track, {
            x: () => -getScrollDistance(),
            ease: 'none',
            scrollTrigger: {
              trigger: bestSellersSection,
              pin: true,
              anticipatePin: 1,
              scrub: 1,
              start: 'center center',
              end: () => `+=${getScrollDistance()}`,
              invalidateOnRefresh: true,
            },
          });
        }
      }
    }

    // Scroll-linked Card Image Parallax
    const cardImgs = document.querySelectorAll('.product-card-motion img');
    cardImgs.forEach((img) => {
      gsap.fromTo(
        img,
        { yPercent: -5 },
        {
          yPercent: 5,
          ease: 'none',
          scrollTrigger: {
            trigger: img.closest('.product-card-motion') || img,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1,
          },
        }
      );
    });
  });

  mm.add('(min-width: 768px) and (max-width: 1023px)', () => {
    const heroSection = document.querySelector('section.h-\\[90vh\\]') || document.querySelector('section');
    if (heroSection) {
      const heroContent = heroSection.querySelector('.max-w-2xl');
      if (heroContent) {
        gsap.to(heroContent, {
          yPercent: -10,
          opacity: 0.4,
          ease: 'none',
          scrollTrigger: {
            trigger: heroSection,
            start: 'top top',
            end: 'bottom top',
            scrub: 1,
          },
        });
      }
    }
  });

  mm.add('(max-width: 767px)', () => {
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowX = 'hidden';

    const productGrids = document.querySelectorAll('.grid.grid-cols-2');
    productGrids.forEach((grid) => {
      gsap.from(grid.children, {
        opacity: 0,
        y: 20,
        stagger: 0.05,
        duration: 0.5,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: grid,
          start: 'top 92%',
          once: true,
        },
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. MASTER INITIALIZATION & SPA RE-OBSERVER
  // ─────────────────────────────────────────────────────────────────────────────
  const initAllEffects = () => {
    initWordReveals();
    insertSectionDividers();
    insertMarquee();
    initCategoryArchMasks();
    initProductDragsAndStaggers();
    initButtonsMotion();
    initFeaturedBanner();
    ScrollTrigger.refresh();
  };

  initAllEffects();

  window.addEventListener('load', () => {
    ScrollTrigger.refresh();
  });

  let debounceTimeout = null;
  const rootEl = document.getElementById('root');
  if (rootEl) {
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        initWordReveals();
        initCategoryArchMasks();
        initButtonsMotion();
        ScrollTrigger.refresh();
      }, 250);
    });

    observer.observe(rootEl, { childList: true, subtree: true });
  }
});

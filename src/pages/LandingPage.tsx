import { ArrowDown, ArrowRight, BellRing, Compass, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

const highlights = [
  {
    number: '01',
    icon: Compass,
    title: 'Bring every leg together',
    description: 'Keep flights, trains and the details around them in one clear itinerary.',
  },
  {
    number: '02',
    icon: BellRing,
    title: 'Know when plans shift',
    description: 'See disruption alerts alongside the journey they affect.',
  },
  {
    number: '03',
    icon: ShieldCheck,
    title: 'Find your next move',
    description: 'Review recovery options and make a plan when travel goes off course.',
  },
]

export function LandingPage() {
  return (
    <main className="wayvo-landing">
      <section className="wayvo-landing__hero" aria-labelledby="landing-title">
        <img
          className="wayvo-landing__image"
          src="/images/wayvo-waterfall.jpg"
          alt="A waterfall winding through a forest"
        />
        <div className="wayvo-landing__scrim" aria-hidden="true" />

        <header className="wayvo-landing__nav">
          <Link to="/" className="wayvo-landing__wordmark" aria-label="Wayvo home">
            <span className="wayvo-landing__mark" aria-hidden="true">W</span>
            Wayvo
          </Link>
          <nav aria-label="Main navigation">
            <a className="wayvo-landing__nav-link" href="#how-it-helps">How it helps</a>
            <Link className="wayvo-landing__nav-login" to="/login">Log in</Link>
          </nav>
        </header>

        <div className="wayvo-landing__hero-content">
          <p className="wayvo-landing__eyebrow"><span /> A steadier way to travel</p>
          <h1 id="landing-title">Make room for the <em>journey.</em></h1>
          <p className="wayvo-landing__intro">
            Keep your plans close, stay ahead of disruptions, and know what to do when travel changes.
          </p>
          <div className="wayvo-landing__actions">
            <Link className="wayvo-landing__primary" to="/signup">
              Start planning <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <a className="wayvo-landing__secondary" href="#how-it-helps">
              See how it helps <ArrowDown size={15} aria-hidden="true" />
            </a>
          </div>
        </div>

        <p className="wayvo-landing__image-note">The best trips leave space for the unexpected.</p>
      </section>

      <section className="wayvo-landing__help" id="how-it-helps" aria-labelledby="help-title">
        <div className="wayvo-landing__help-heading">
          <p className="wayvo-landing__section-label">Travel, with a plan</p>
          <h2 id="help-title">Ready for the route.<br />Prepared for the reroute.</h2>
        </div>
        <div className="wayvo-landing__highlights">
          {highlights.map(({ number, icon: Icon, title, description }) => (
            <article className="wayvo-landing__highlight" key={number}>
              <div className="wayvo-landing__highlight-top">
                <span className="wayvo-landing__highlight-icon"><Icon size={19} strokeWidth={1.8} aria-hidden="true" /></span>
                <span className="wayvo-landing__number">{number}</span>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="wayvo-landing__footer">
        <Link to="/" className="wayvo-landing__wordmark"><span className="wayvo-landing__mark" aria-hidden="true">W</span>Wayvo</Link>
        <span>Travel changes. Your plan can too.</span>
        <Link to="/signup">Make a plan <ArrowRight size={14} aria-hidden="true" /></Link>
      </footer>
    </main>
  )
}
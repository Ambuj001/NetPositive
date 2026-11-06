import { motion, useScroll, useTransform } from 'motion/react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  FingerprintPattern,
  ShieldCheck,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/ui'
import { RateCalculator } from '../components/RateCalculator'
import { inr } from '../lib/engine'
const ease = [0.16, 1, 0.3, 1] as const
export default function Landing() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })
  const y = useTransform(scrollYProgress, [0, 1], [0, 65])
  const [amount, setAmount] = useState(10000)
  return (
    <div className="landing-page">
      <section className="landing-hero" ref={ref}>
        <motion.div className="hero-copy" style={{ y }}>
          <motion.span
            className="eyebrow hero-eyebrow"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            More value. Both ways.
          </motion.span>
          <h1>
            {['Your crypto.', 'Your cards.', 'Better together.'].map(
              (text, i) => (
                <motion.span
                  key={text}
                  initial={{ opacity: 0, y: 25, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.85, delay: 0.12 + i * 0.1, ease }}
                >
                  {text}
                </motion.span>
              ),
            )}
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            Pay for what you love with crypto.
            <br />
            Or buy USDC and keep your card rewards.
          </motion.p>
        </motion.div>
        <motion.div
          className="hero-circles"
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.35, ease }}
        >
          <Link to="/home?mode=sell" className="hero-circle pay">
            <span className="circle-icon">
              <ArrowUpRight size={26} />
            </span>
            <span className="circle-label">
              Put your crypto
              <br />
              to everyday use.
            </span>
            <strong>
              Pay with crypto
              <ArrowUpRight size={18} />
            </strong>
          </Link>
          <div className="circle-intersection" aria-hidden="true">
            <span>
              N<sup>+</sup>
            </span>
          </div>
          <Link to="/home" className="hero-circle buy">
            <span className="circle-icon">
              <ArrowDownLeft size={26} />
            </span>
            <span className="circle-label">
              Make more of
              <br />
              your card rewards.
            </span>
            <strong>
              Buy USDC
              <ArrowRight size={18} />
            </strong>
          </Link>
        </motion.div>
        <div className="hero-brands">
          <span>Everyday favourites</span>
          {['lifestyle', 'amazon', 'myntra', 'croma', 'swiggy'].map((b) => (
            <BrandMark id={b} key={b} size={29} />
          ))}
          <Link to="/market">
            Explore vouchers
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
      <motion.section
        className="landing-section how-section"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.7, ease }}
      >
        <div className="section-intro">
          <span className="eyebrow">One trade. Two wins.</span>
          <h2>
            A voucher connects
            <br />
            both sides.
          </h2>
          <p>
            One person wants to shop. The other wants crypto. A gift voucher
            brings them together.
          </p>
        </div>
        <div className="how-steps">
          {[
            {
              n: '01',
              title: 'Choose what you need.',
              body: 'Pick a voucher to pay with crypto, or set an amount to buy USDC.',
            },
            {
              n: '02',
              title: 'Find your match.',
              body: 'Match a voucher request with someone buying crypto.',
            },
            {
              n: '03',
              title: 'Keep the value.',
              body: 'The shopper gets their voucher. The buyer gets USDC and their eligible card rewards.',
            },
          ].map((s) => (
            <motion.div key={s.n} whileHover={{ x: 4 }}>
              <span>{s.n}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>
      <motion.section
        className="landing-section landing-calculator"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.7, ease }}
      >
        <div className="section-intro">
          <span className="eyebrow">Know your numbers</span>
          <h2>
            Your real rate,
            <br />
            before you trade.
          </h2>
          <p>
            See how a voucher purchase and card rewards change your effective
            USDC cost.
          </p>
          <label className="landing-amount">
            <span>Voucher value</span>
            <strong>{inr(amount)}</strong>
            <input
              type="range"
              min={1000}
              max={50000}
              step={500}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Example voucher value"
            />
            <div>
              <span>₹1,000</span>
              <span>₹50,000</span>
            </div>
          </label>
        </div>
        <div className="np-panel landing-rate-panel">
          <div className="panel-heading">
            <h3>Example at ₹90 / USDC</h3>
            <span className="status-badge">Illustrative</span>
          </div>
          <RateCalculator
            amount={amount}
            receive={Math.round((amount / 90) * 100) / 100}
          />
        </div>
      </motion.section>
      <section className="landing-section trust-section">
        <div className="section-intro">
          <span className="eyebrow">Built around your control</span>
          <h2>
            Simple to use.
            <br />
            Clear by design.
          </h2>
        </div>
        <div className="trust-grid">
          {[
            {
              icon: CreditCard,
              title: 'Your rewards stay yours.',
              text: 'No buyer platform fee. Use your own cards and reward preferences.',
            },
            {
              icon: ShieldCheck,
              title: 'One clear seller fee.',
              text: 'A 1% fee for paying with crypto, shown before you confirm.',
            },
            {
              icon: FingerprintPattern,
              title: 'Your account. Your wallet.',
              text: 'Connect your wallet and link World ID from your profile.',
            },
          ].map((x, i) => (
            <motion.div
              className="trust-card"
              key={x.title}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              <x.icon size={23} strokeWidth={1.5} />
              <h3>{x.title}</h3>
              <p>{x.text}</p>
            </motion.div>
          ))}
        </div>
      </section>
      <motion.section
        className="landing-cta"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <span className="eyebrow">Make the next move.</span>
        <h2>
          Get more from
          <br />
          what you already have.
        </h2>
        <div>
          <Link className="np-button" to="/home?mode=sell">
            Pay with crypto
            <ArrowUpRight size={16} />
          </Link>
          <Link className="np-button secondary" to="/home">
            Buy USDC
            <ArrowRight size={16} />
          </Link>
        </div>
      </motion.section>
    </div>
  )
}

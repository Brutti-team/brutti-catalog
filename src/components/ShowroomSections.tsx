import { ArrowRight, DraftingCompass, Hammer, Layers3 } from "lucide-react";

const referenceImage = (name: string) =>
  import.meta.env.BASE_URL + "reference/" + name + ".jpg";

const collectionTypes = [
  { title: "Retail kiosks", image: "kiosk", keyword: "kiosk", text: "Destinations designed around the customer experience.", category: "01" },
  { title: "Cabinetry & joinery", image: "cabinetry", keyword: "cabinet", text: "Considered storage, made to work beautifully.", category: "02" },
  { title: "Display & counters", image: "counter", keyword: "counter", text: "Signature details for expressive commercial spaces.", category: "03" },
  { title: "Custom furniture", image: "sofa", keyword: "furniture", text: "Furniture designed for the room, not just the floor plan.", category: "04" },
] as const;

export default function ShowroomSections({ onExplore, section = "categories" }: { onExplore: (keyword: string) => void; section?: "categories" | "approach" }) {
  if (section === "categories") return (
    <>
      <section className="pub-reference-intro" id="pub-expertise">
        <div className="pub-reference-intro-head">
          <p className="pub-reference-eyebrow">WHAT WE CREATE / BENUA BRUTTI</p>
          <h2>One partner.<br /><em>Every detail, considered.</em></h2>
        </div>
        <p>We design and build tailored furniture, kiosks and commercial interiors that work beautifully, endure daily use and express your space.</p>
      </section>

      <section className="pub-reference-category-grid" aria-label="Explore furniture and fabrication categories">
        {collectionTypes.map((type) => (
          <button
            type="button"
            key={type.title}
            className="pub-reference-category-tile"
            onClick={() => onExplore(type.keyword)}
            aria-label={"Explore " + type.title}
          >
            <img src={referenceImage(type.image)} loading="lazy" alt={type.title + " design inspiration"} />
            <span className="pub-reference-category-shade" />
            <span className="pub-reference-category-index">{type.category} / CUSTOM MADE</span>
            <span className="pub-reference-category-caption">
              <span><strong>{type.title}</strong><small>{type.text}</small></span>
              <ArrowRight size={23} />
            </span>
          </button>
        ))}
      </section>
      <p className="pub-reference-image-note">Editorial inspiration images · Actual Brutti product records and photos appear in the collection below.</p>

    </>
  );
  return (
    <>
      <section className="pub-reference-process" id="pub-process">
        <div className="pub-reference-process-top">
          <div><p className="pub-reference-eyebrow">OUR APPROACH</p><h2>Designed with purpose.<br /><em>Finished with care.</em></h2></div>
          <p>Good fabrication is more than its final shape. From brief to finishing detail, every decision is shaped around how your space should look, feel and function.</p>
        </div>
        <div className="pub-reference-process-grid">
          <article><DraftingCompass size={27} strokeWidth={1.4} /><span>01 / DESIGN</span><h3>Tailored by nature</h3><p>Solutions built around your brief, business and daily operation.</p></article>
          <article><Layers3 size={27} strokeWidth={1.4} /><span>02 / MATERIALS</span><h3>Material character</h3><p>Timber, stone, metal and finishes considered as one composition.</p></article>
          <article><Hammer size={27} strokeWidth={1.4} /><span>03 / CRAFT</span><h3>Made with intention</h3><p>Thoughtful construction and practical details that last.</p></article>
        </div>
      </section>
      <section className="pub-reference-wide-feature">
        <img src={referenceImage("hero")} alt="Bespoke interior design inspiration" loading="lazy" />
        <div>
          <p className="pub-reference-eyebrow">YOUR SPACE. OUR CRAFT.</p>
          <h2>Made for the<br /><em>way you work.</em></h2>
          <button type="button" onClick={() => onExplore("")}>Explore the collection <ArrowRight size={18} /></button>
        </div>
      </section>
    </>
  );
}

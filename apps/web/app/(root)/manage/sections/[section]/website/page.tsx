import { Suspense } from "react";
import { ActionForm, Field } from "@/components/forms/action-form";
import { PhotoUploader } from "@/components/manage/photo-uploader";
import { WebsiteFields } from "@/components/manage/website-fields";
import { sectionPhoto, sectionPhotoUrl } from "@/lib/site/kinds";
import { sectionPath } from "@/lib/site/paths";
import { m } from "@/messages";
import { saveWebsiteAction } from "../../actions";
import { ownerSection } from "../owner-section";

/** What the website shows for a section: its name, description, photo and colour. */
async function Website({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await ownerSection(params);
  const w = m.manage.website;
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-4 sm:p-5">
      <h2 className="font-display text-2xl uppercase tracking-wide">{w.title}</h2>
      <ActionForm action={saveWebsiteAction.bind(null, section.id)} submitLabel={m.manage.save} variant="default" className="max-w-2xl gap-5">
        <div className="flex flex-col gap-1">
          <Field name="name" label={m.manage.name} defaultValue={section.name} required maxLength={80} />
          <p className="text-xs text-muted-foreground">{w.address(sectionPath(section.slug))}</p>
        </div>
        <WebsiteFields name={section.name} description={section.description} accent={section.accent} />
        <PhotoUploader
          folder={`${section.organizationId}/sections/${section.id}`}
          currentPath={section.photoPath}
          currentUrl={sectionPhotoUrl(section)}
          stockUrl={sectionPhoto(section.kind)}
        />
      </ActionForm>
    </section>
  );
}

export default function WebsitePage({ params }: PageProps<"/manage/sections/[section]/website">) {
  return (
    <Suspense fallback={null}>
      <Website params={params} />
    </Suspense>
  );
}
